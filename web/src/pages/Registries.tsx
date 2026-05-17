import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, TestTube2, Loader2, Eye, EyeOff, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  listRegistries, createRegistry, updateRegistry, deleteRegistry, testRegistry,
  type Registry, type RegistryForm,
} from "@/api/registries";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function RegistryFormDialog({
  open,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial?: Registry;
  onClose: () => void;
  onSubmit: (data: RegistryForm) => Promise<void>;
}) {
  const [form, setForm] = useState<RegistryForm>({
    name: initial?.name ?? "",
    url: initial?.url ?? "",
    username: initial?.username ?? "",
    secret: "",
  });
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  const field = (f: keyof RegistryForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [f]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.url || !form.username || (!form.secret && !initial)) {
      toast.error("All fields are required");
      return;
    }
    setSaving(true);
    try {
      await onSubmit(form);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{initial ? "Edit Registry" : "Add Registry"}</AlertDialogTitle>
          <AlertDialogDescription>
            Credentials are stored and used by Docker when pulling images.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <input
              value={form.name}
              onChange={field("name")}
              placeholder="My Registry"
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Registry URL</label>
            <input
              value={form.url}
              onChange={field("url")}
              placeholder="ghcr.io or gcr.io or registry.example.com"
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Username</label>
            <input
              value={form.username}
              onChange={field("username")}
              placeholder="username or _json_key"
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {initial ? "Password / Token (leave blank to keep existing)" : "Password / Token"}
            </label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                value={form.secret}
                onChange={field("secret")}
                placeholder={initial ? "••••••••" : "PAT or service account JSON"}
                className="w-full rounded border border-input bg-background px-3 py-2 pr-9 text-sm font-mono outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => setShowSecret((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel type="button" onClick={onClose}>Cancel</AlertDialogCancel>
            <AlertDialogAction type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {initial ? "Save changes" : "Add registry"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function Registries() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Registry | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);

  const { data: registries = [], isLoading } = useQuery({
    queryKey: ["registries"],
    queryFn: listRegistries,
  });

  const create = useMutation({
    mutationFn: (data: RegistryForm) => createRegistry(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["registries"] }); toast.success("Registry added"); },
    onError: (e: Error) => toast.error(e.message || "Failed to add registry"),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: RegistryForm }) => updateRegistry(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["registries"] }); toast.success("Registry updated"); },
    onError: (e: Error) => toast.error(e.message || "Failed to update registry"),
  });

  const del = useMutation({
    mutationFn: (id: number) => deleteRegistry(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["registries"] }); toast.success("Registry removed"); setDeletingId(null); },
    onError: (e: Error) => toast.error(e.message || "Failed to delete registry"),
  });

  async function handleTest(id: number) {
    setTestingId(id);
    try {
      await testRegistry(id);
      toast.success("Connection successful");
    } catch (e: unknown) {
      toast.error((e as Error).message || "Connection failed");
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Image Registries</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage credentials for private Docker registries</p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setDialogOpen(true); }}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus className="size-3.5" /> Add registry
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : registries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 py-16 text-center">
          <p className="text-sm text-muted-foreground">No registries configured</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Add a registry to enable pulling from private sources and version detection</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div
            className="grid items-center gap-3 px-4 py-2.5 border-b border-border bg-secondary/10 text-xs text-muted-foreground"
            style={{ gridTemplateColumns: "1.5fr 2fr 1.5fr 1fr 1fr" }}
          >
            <span>Name</span><span>URL</span><span>Username</span><span>Added</span><span className="text-right">Actions</span>
          </div>
          <div className="divide-y divide-border/50">
            {registries.map((reg) => (
              <div
                key={reg.id}
                className="grid items-center gap-3 px-4 py-3 text-sm hover:bg-secondary/20 transition-colors"
                style={{ gridTemplateColumns: "1.5fr 2fr 1.5fr 1fr 1fr" }}
              >
                <span className="font-medium truncate">{reg.name}</span>
                <span className="font-mono text-xs text-muted-foreground truncate">{reg.url}</span>
                <span className="font-mono text-xs text-muted-foreground truncate">{reg.username}</span>
                <span className="text-xs text-muted-foreground">{formatDate(reg.createdAt)}</span>
                <div className="flex items-center gap-1 justify-end">
                  <button
                    onClick={() => handleTest(reg.id)}
                    disabled={testingId === reg.id}
                    title="Test connection"
                    className={cn(
                      "rounded p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40",
                    )}
                  >
                    {testingId === reg.id ? <Loader2 className="size-3.5 animate-spin" /> : <TestTube2 className="size-3.5" />}
                  </button>
                  <button
                    onClick={() => { setEditTarget(reg); setDialogOpen(true); }}
                    title="Edit"
                    className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => setDeletingId(reg.id)}
                    title="Delete"
                    className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <RegistryFormDialog
        open={dialogOpen}
        initial={editTarget ?? undefined}
        onClose={() => setDialogOpen(false)}
        onSubmit={async (data) => {
          if (editTarget) {
            await update.mutateAsync({ id: editTarget.id, data });
          } else {
            await create.mutateAsync(data);
          }
        }}
      />

      <AlertDialog open={deletingId !== null} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove registry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the credentials and run <code>docker logout</code>. Images that use this registry will continue to work with locally cached layers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingId !== null && del.mutate(deletingId)}
              className="bg-destructive text-white hover:opacity-90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
