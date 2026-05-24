import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, Trash2, TestTube2, Loader2, Eye, EyeOff, Pencil,
  ChevronDown, ChevronRight, Tag, Package, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  listRegistries, createRegistry, updateRegistry, deleteRegistry, testRegistry,
  listRepositories, listRepoTags,
  type Registry, type RegistryForm,
} from "@/api/registries";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// ─── Registry Form Dialog ─────────────────────────────────────────────────────

function RegistryFormDialog({
  open, initial, onClose, onSubmit,
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

// ─── Repo Tags Panel ──────────────────────────────────────────────────────────

function RepoTagsPanel({ registryId, repoName, registryUrl }: { registryId: number; repoName: string; registryUrl: string }) {
  const [expanded, setExpanded] = useState(false);

  const { data: tags, isLoading, error } = useQuery({
    queryKey: ["registry-tags", registryId, repoName],
    queryFn: () => listRepoTags(registryId, repoName),
    enabled: expanded,
    staleTime: 2 * 60_000,
  });

  const host = registryUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <div className="border-b border-border/30 last:border-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs hover:bg-secondary/20 transition-colors"
      >
        {expanded ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
        <Package className="size-3 text-muted-foreground shrink-0" />
        <span className="font-mono text-left truncate">{repoName}</span>
      </button>

      {expanded && (
        <div className="pl-10 pb-2">
          {isLoading && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-1">
              <Loader2 className="size-3 animate-spin" /> Loading tags…
            </div>
          )}
          {error && (
            <p className="text-xs text-destructive py-1">Failed to load tags</p>
          )}
          {tags && tags.length === 0 && (
            <p className="text-xs text-muted-foreground py-1">No tags found</p>
          )}
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {tags.sort().map((tag) => (
                <span
                  key={tag}
                  title={`${host}/${repoName}:${tag}`}
                  className="inline-flex items-center gap-1 rounded border border-border bg-secondary/30 px-2 py-0.5 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Tag className="size-2.5" />
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Registry Card ────────────────────────────────────────────────────────────

function RegistryCard({
  reg,
  onEdit,
  onDelete,
}: {
  reg: Registry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [testingId, setTestingId] = useState(false);

  const { data: repos, isLoading: reposLoading, error: reposError } = useQuery({
    queryKey: ["registry-repos", reg.id],
    queryFn: () => listRepositories(reg.id),
    enabled: expanded,
    staleTime: 5 * 60_000,
  });

  async function handleTest() {
    setTestingId(true);
    try {
      await testRegistry(reg.id);
      toast.success("Connection successful");
    } catch (e: unknown) {
      toast.error((e as Error).message || "Connection failed");
    } finally {
      setTestingId(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title={expanded ? "Collapse" : "Browse repositories"}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{reg.name}</span>
            <span className="font-mono text-xs text-muted-foreground truncate">{reg.url}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {reg.username} · Added {formatDate(reg.createdAt)}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleTest}
            disabled={testingId}
            title="Test connection"
            className="rounded p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
          >
            {testingId ? <Loader2 className="size-3.5 animate-spin" /> : <TestTube2 className="size-3.5" />}
          </button>
          <button
            onClick={onEdit}
            title="Edit"
            className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            onClick={onDelete}
            title="Delete"
            className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Repository browser */}
      {expanded && (
        <div className="border-t border-border bg-secondary/5">
          {reposLoading && (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Loading repositories…
            </div>
          )}
          {reposError && (
            <div className="px-4 py-3 text-xs text-destructive">
              Failed to load repositories. The registry may not support the catalog API.
            </div>
          )}
          {repos && repos.length === 0 && (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              No repositories found (catalog API may be disabled on this registry).
            </div>
          )}
          {repos && repos.length > 0 && (
            <div>
              <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border/30 flex items-center gap-1.5">
                <Download className="size-3" />
                {repos.length} repositories — click to browse tags
              </div>
              {repos.map((repo) => (
                <RepoTagsPanel
                  key={repo}
                  registryId={reg.id}
                  repoName={repo}
                  registryUrl={reg.url}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function Registries() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Registry | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

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
        <div className="space-y-3">
          {registries.map((reg) => (
            <RegistryCard
              key={reg.id}
              reg={reg}
              onEdit={() => { setEditTarget(reg); setDialogOpen(true); }}
              onDelete={() => setDeletingId(reg.id)}
            />
          ))}
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
