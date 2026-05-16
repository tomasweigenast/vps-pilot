import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, ChevronDown, ChevronRight } from "lucide-react";
import { getRoles, createRole, updateRole, deleteRole } from "@/api/roles";
import { listProjects } from "@/api/projects";
import type { Role, Permission } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const ALL_ACTIONS = ["view", "start", "stop", "restart", "deploy", "logs", "files", "manage"] as const;
type Action = typeof ALL_ACTIONS[number];

export function Roles() {
  const qc = useQueryClient();
  const { data: roles = [], isLoading } = useQuery({ queryKey: ["roles"], queryFn: getRoles });
  const [editorRole, setEditorRole] = useState<Role | null | "new">(null);

  const remove = useMutation({
    mutationFn: (id: number) => deleteRole(id),
    onSuccess: () => {
      toast.success("Role deleted");
      qc.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Roles</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Define permissions for users</p>
        </div>
        <Button size="sm" onClick={() => setEditorRole("new")}>
          <Plus className="size-4 mr-1.5" />
          New Role
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-3">
          {roles.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              onEdit={() => setEditorRole(role)}
              onDelete={() => {
                if (confirm(`Delete role "${role.name}"?`)) remove.mutate(role.id);
              }}
            />
          ))}
          {roles.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No roles defined. Create one to start assigning permissions.
            </p>
          )}
        </div>
      )}

      {editorRole !== null && (
        <RoleEditor
          role={editorRole === "new" ? null : editorRole}
          onClose={() => setEditorRole(null)}
        />
      )}
    </div>
  );
}

function RoleCard({
  role,
  onEdit,
  onDelete,
}: {
  role: Role;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{role.name}</span>
            {role.isSystem && <Badge className="text-xs">system</Badge>}
          </div>
          {role.description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{role.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {role.permissions.length} permission{role.permissions.length !== 1 ? "s" : ""}
          </span>
          {!role.isSystem && (
            <>
              <button
                onClick={onEdit}
                className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                onClick={onDelete}
                className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="size-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 py-3 bg-secondary/20">
          {role.permissions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No permissions defined.</p>
          ) : (
            <div className="space-y-2">
              {role.permissions.map((p) => (
                <div key={p.id} className="flex items-start gap-3">
                  <span className="text-xs font-mono bg-secondary px-1.5 py-0.5 rounded min-w-20 text-center">
                    {p.projectName === "*" ? "all projects" : p.projectName}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {p.actions.map((a) => (
                      <span
                        key={a}
                        className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type PermissionDraft = Omit<Permission, "id" | "roleId">;

function RoleEditor({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const qc = useQueryClient();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissions, setPermissions] = useState<PermissionDraft[]>(
    role?.permissions.map((p) => ({ projectName: p.projectName, actions: [...p.actions] })) ?? []
  );

  const save = useMutation({
    mutationFn: async () => {
      if (role) {
        await updateRole(role.id, { name, description, permissions });
      } else {
        await createRole({ name, description, permissions });
      }
    },
    onSuccess: () => {
      toast.success(role ? "Role updated" : "Role created");
      qc.invalidateQueries({ queryKey: ["roles"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function addPermission() {
    setPermissions((prev) => [...prev, { projectName: "*", actions: [] }]);
  }

  function removePermission(idx: number) {
    setPermissions((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateProject(idx: number, projectName: string) {
    setPermissions((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, projectName } : p))
    );
  }

  function toggleAction(idx: number, action: Action) {
    setPermissions((prev) =>
      prev.map((p, i) => {
        if (i !== idx) return p;
        const actions = p.actions.includes(action)
          ? p.actions.filter((a) => a !== action)
          : [...p.actions, action];
        return { ...p, actions };
      })
    );
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{role ? `Edit Role — ${role.name}` : "New Role"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                placeholder="developer"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Description
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                placeholder="Optional description"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Permissions
              </label>
              <button
                onClick={addPermission}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <Plus className="size-3" /> Add
              </button>
            </div>

            {permissions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No permissions. This role will have no access.
              </p>
            )}

            {permissions.map((perm, idx) => (
              <div key={idx} className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-muted-foreground">Project</label>
                    <ProjectSelect
                      value={perm.projectName}
                      onChange={(v) => updateProject(idx, v)}
                      projects={projects.map((p) => p.name)}
                    />
                  </div>
                  <button
                    onClick={() => removePermission(idx)}
                    className="mt-5 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_ACTIONS.map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => toggleAction(idx, action)}
                      className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                        perm.actions.includes(action)
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!name || save.isPending}>
            {role ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectSelect({
  value,
  onChange,
  projects,
}: {
  value: string;
  onChange: (v: string) => void;
  projects: string[];
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const options = ["*", ...projects].filter(
    (p) => p === "*" || p.toLowerCase().includes(query.toLowerCase())
  );

  function select(v: string) {
    onChange(v);
    setQuery(v);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-full rounded border border-input bg-background px-2 py-1 text-sm outline-none focus:border-primary"
        placeholder="* or search project…"
      />
      {open && options.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md text-sm max-h-40 overflow-y-auto">
          {options.map((p) => (
            <li
              key={p}
              onMouseDown={() => select(p)}
              className={`px-2 py-1.5 cursor-pointer hover:bg-secondary ${
                p === value ? "text-primary font-medium" : ""
              }`}
            >
              {p === "*" ? (
                <span>
                  <span className="font-mono">*</span>
                  <span className="text-muted-foreground ml-2 text-xs">all projects</span>
                </span>
              ) : (
                p
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
