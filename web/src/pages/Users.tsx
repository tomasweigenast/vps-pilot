import { useRef, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, UserCog } from "lucide-react";
import { getUsers, createUser, updateUser, deleteUser } from "@/api/users";
import { getRoles } from "@/api/roles";
import { listProjects } from "@/api/projects";
import { useAuthStore } from "@/store/auth";
import type { UserView, Role, Permission } from "@/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const PROJECT_ACTIONS = ["view", "start", "stop", "restart", "deploy", "logs", "files", "manage"] as const;
const GLOBAL_ACTIONS = ["view_dashboard", "view_system", "view_logs", "view_files", "edit_files", "view_audit"] as const;

type PermissionDraft = Pick<Permission, "projectName" | "actions">;

export function Users() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.username);
  const { data: users = [], isLoading } = useQuery({ queryKey: ["users"], queryFn: getUsers });

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserView | null>(null);

  const toggleDisabled = useMutation({
    mutationFn: ({ id, disabled }: { id: number; disabled: boolean }) =>
      updateUser(id, { disabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeUser = useMutation({
    mutationFn: (id: number) => deleteUser(id),
    onSuccess: () => {
      toast.success("User removed");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage user access and roles</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4 mr-1.5" />
          New User
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Username</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Access</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Last Login</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-secondary/20 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    {u.username}
                    {u.username === me && (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{u.authType}</td>
                  <td className="px-4 py-3">
                    <UserAccessSummary user={u} />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleDisabled.mutate({ id: u.id, disabled: !u.disabled })}
                      disabled={u.username === me}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                        u.disabled
                          ? "bg-destructive/15 text-destructive hover:bg-destructive/25"
                          : "bg-green-500/15 text-green-600 hover:bg-green-500/25"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {u.disabled ? "Disabled" : "Active"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => setEditUser(u)}
                        className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit access"
                      >
                        <UserCog className="size-4" />
                      </button>
                      {u.username !== me && (
                        <button
                          onClick={() => setDeleteTarget(u)}
                          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Remove"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      {editUser && (
        <EditAccessDialog user={editUser} onClose={() => setEditUser(null)} />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Remove ${deleteTarget?.username}?`}
        description="The user will be removed and will no longer be able to log in."
        confirmLabel="Remove"
        destructive
        onConfirm={() => { removeUser.mutate(deleteTarget!.id); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function UserAccessSummary({ user }: { user: UserView }) {
  const hasRoles = user.roles.length > 0;
  const hasCustom = user.customPermissions.length > 0;

  if (!hasRoles && !hasCustom) {
    return <span className="text-xs text-muted-foreground">No access</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {user.roles.map((r) => (
        <Badge key={r.id} variant={r.isSystem ? "default" : "secondary"}>
          {r.name}
        </Badge>
      ))}
      {hasCustom && (
        <Badge variant="outline" className="text-xs">
          {user.customPermissions.length} custom permission{user.customPermissions.length !== 1 ? "s" : ""}
        </Badge>
      )}
    </div>
  );
}

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: roles = [] } = useQuery({ queryKey: ["roles"], queryFn: getRoles });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<number[]>([]);
  const [permissions, setPermissions] = useState<PermissionDraft[]>([]);

  // Reset form whenever dialog opens
  useEffect(() => {
    if (open) {
      setUsername("");
      setPassword("");
      setSelectedRoles([]);
      setPermissions([]);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () => createUser({ username, password, roleIds: selectedRoles, permissions }),
    onSuccess: () => {
      toast.success("User created");
      qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
      setUsername("");
      setPassword("");
      setPermissions([]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New User</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                placeholder="username"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Password</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                placeholder="••••••••"
              />
            </div>
          </div>
          <RoleSelector roles={roles} selected={selectedRoles} onChange={setSelectedRoles} />
          <div className="border-t border-border pt-4">
            <PermissionBuilder permissions={permissions} onChange={setPermissions} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!username || !password || create.isPending}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditAccessDialog({ user, onClose }: { user: UserView; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: roles = [] } = useQuery({ queryKey: ["roles"], queryFn: getRoles });
  const [selectedRoles, setSelectedRoles] = useState<number[]>(user.roles.map((r) => r.id));
  const [permissions, setPermissions] = useState<PermissionDraft[]>(
    user.customPermissions.map((p) => ({ projectName: p.projectName, actions: [...p.actions] }))
  );

  const save = useMutation({
    mutationFn: () => updateUser(user.id, {
      roleIds: selectedRoles,
      permissions,
      clearPermissions: permissions.length === 0,
    }),
    onSuccess: () => {
      toast.success("Access updated");
      qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Access — {user.username}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <RoleSelector roles={roles} selected={selectedRoles} onChange={setSelectedRoles} />
          <div className="border-t border-border pt-4">
            <PermissionBuilder permissions={permissions} onChange={setPermissions} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermissionBuilder({
  permissions,
  onChange,
}: {
  permissions: PermissionDraft[];
  onChange: (p: PermissionDraft[]) => void;
}) {
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  function add() {
    onChange([...permissions, { projectName: "*", actions: [] }]);
  }

  function remove(idx: number) {
    onChange(permissions.filter((_, i) => i !== idx));
  }

  function updateProject(idx: number, projectName: string) {
    onChange(permissions.map((p, i) => (i === idx ? { ...p, projectName } : p)));
  }

  function toggleAction(idx: number, action: string) {
    onChange(
      permissions.map((p, i) => {
        if (i !== idx) return p;
        const actions = p.actions.includes(action)
          ? p.actions.filter((a) => a !== action)
          : [...p.actions, action];
        return { ...p, actions };
      })
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Custom Permissions
        </label>
        <button onClick={add} className="text-xs text-primary hover:underline flex items-center gap-1">
          <Plus className="size-3" /> Add
        </button>
      </div>

      {permissions.length === 0 && (
        <p className="text-xs text-muted-foreground">No custom permissions. User will rely on assigned roles only.</p>
      )}

      {permissions.map((perm, idx) => (
        <div key={idx} className="rounded-md border border-border p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Project</label>
              <ProjectSelect
                value={perm.projectName}
                onChange={(v) => updateProject(idx, v)}
                projects={projects.map((p) => p.name)}
              />
            </div>
            <button
              onClick={() => remove(idx)}
              className="mt-5 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Project actions</p>
            <div className="flex flex-wrap gap-1.5">
              {PROJECT_ACTIONS.map((action) => (
                <ActionToggle
                  key={action}
                  label={action}
                  active={perm.actions.includes(action)}
                  onClick={() => toggleAction(idx, action)}
                />
              ))}
            </div>
          </div>

          {perm.projectName === "*" && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Section access</p>
              <div className="flex flex-wrap gap-1.5">
                {GLOBAL_ACTIONS.map((action) => (
                  <ActionToggle
                    key={action}
                    label={action}
                    active={perm.actions.includes(action)}
                    onClick={() => toggleAction(idx, action)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ActionToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function RoleSelector({
  roles,
  selected,
  onChange,
}: {
  roles: Role[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  function toggle(id: number) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Roles</label>
      <div className="space-y-1 max-h-36 overflow-y-auto">
        {roles.map((r) => (
          <label key={r.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-secondary/50 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(r.id)}
              onChange={() => toggle(r.id)}
              className="rounded"
            />
            <span className="text-sm">{r.name}</span>
            {r.isSystem && <Badge className="ml-auto text-xs">system</Badge>}
            {r.description && <span className="text-xs text-muted-foreground truncate">{r.description}</span>}
          </label>
        ))}
        {roles.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-1">No roles defined yet.</p>
        )}
      </div>
    </div>
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

  useEffect(() => { setQuery(value); }, [value]);

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
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className="w-full rounded border border-input bg-background px-2 py-1 text-sm outline-none focus:border-primary"
        placeholder="* or project name…"
      />
      {open && options.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md text-sm max-h-40 overflow-y-auto">
          {options.map((p) => (
            <li
              key={p}
              onMouseDown={() => select(p)}
              className={`px-2 py-1.5 cursor-pointer hover:bg-secondary ${p === value ? "text-primary font-medium" : ""}`}
            >
              {p === "*" ? (
                <span><span className="font-mono">*</span><span className="text-muted-foreground ml-2 text-xs">all projects</span></span>
              ) : p}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
