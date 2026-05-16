import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, UserCog } from "lucide-react";
import { getUsers, createUser, updateUser, deleteUser } from "@/api/users";
import { getRoles } from "@/api/roles";
import { useAuthStore } from "@/store/auth";
import type { UserView, Role } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function Users() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.username);
  const { data: users = [], isLoading } = useQuery({ queryKey: ["users"], queryFn: getUsers });
  const { data: roles = [] } = useQuery({ queryKey: ["roles"], queryFn: getRoles });

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserView | null>(null);

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
                <th className="px-4 py-3 text-left font-medium">Roles</th>
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
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No roles</span>
                      ) : (
                        u.roles.map((r) => (
                          <Badge key={r.id} variant={r.isSystem ? "default" : "secondary"}>
                            {r.name}
                          </Badge>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() =>
                        toggleDisabled.mutate({ id: u.id, disabled: !u.disabled })
                      }
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
                        title="Edit roles"
                      >
                        <UserCog className="size-4" />
                      </button>
                      {u.username !== me && (
                        <button
                          onClick={() => {
                            if (confirm(`Remove ${u.username}?`)) removeUser.mutate(u.id);
                          }}
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

      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        roles={roles}
      />

      {editUser && (
        <EditRolesDialog
          user={editUser}
          roles={roles}
          onClose={() => setEditUser(null)}
        />
      )}
    </div>
  );
}

function CreateUserDialog({
  open,
  onClose,
  roles,
}: {
  open: boolean;
  onClose: () => void;
  roles: Role[];
}) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<number[]>([]);

  const create = useMutation({
    mutationFn: () => createUser({ username, password, roleIds: selectedRoles }),
    onSuccess: () => {
      toast.success("User created");
      qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
      setUsername("");
      setPassword("");
      setSelectedRoles([]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New User</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Username
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              placeholder="username"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Password
            </label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              placeholder="••••••••"
            />
          </div>
          <RoleSelector roles={roles} selected={selectedRoles} onChange={setSelectedRoles} />
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

function EditRolesDialog({
  user,
  roles,
  onClose,
}: {
  user: UserView;
  roles: Role[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [selectedRoles, setSelectedRoles] = useState<number[]>(user.roles.map((r) => r.id));

  const save = useMutation({
    mutationFn: () => updateUser(user.id, { roleIds: selectedRoles }),
    onSuccess: () => {
      toast.success("Roles updated");
      qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Roles — {user.username}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <RoleSelector roles={roles} selected={selectedRoles} onChange={setSelectedRoles} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Roles
      </label>
      <div className="space-y-1 max-h-48 overflow-y-auto">
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
            {r.description && (
              <span className="text-xs text-muted-foreground truncate">{r.description}</span>
            )}
          </label>
        ))}
        {roles.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-1">No roles defined yet.</p>
        )}
      </div>
    </div>
  );
}
