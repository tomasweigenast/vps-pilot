import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Network, Search, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { listAllNetworks, createNetwork, deleteNetwork } from "@/api/docker";
import type { NetworkSummary } from "@/types";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

function InUseBadge({ inUse }: { inUse: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
      inUse
        ? "bg-green-500/10 text-green-400 ring-green-500/20"
        : "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20"
    )}>
      <span className={cn("size-1.5 rounded-full", inUse ? "bg-green-400" : "bg-zinc-500")} />
      {inUse ? "In use" : "Unused"}
    </span>
  );
}

function CreateNetworkDialog({
  open, onClose, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (req: { name: string; driver: string; internal: boolean }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [driver, setDriver] = useState("bridge");
  const [internal, setInternal] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), driver, internal });
      setName(""); setDriver("bridge"); setInternal(false);
      onClose();
    } finally { setSaving(false); }
  }

  if (!open) return null;
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Create network</AlertDialogTitle>
          <AlertDialogDescription>Add a new Docker network to the host.</AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-1">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Name <span className="text-destructive">*</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-network"
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Driver</label>
            <select value={driver} onChange={(e) => setDriver(e.target.value)}
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary">
              <option value="bridge">bridge</option>
              <option value="overlay">overlay</option>
              <option value="host">host</option>
              <option value="macvlan">macvlan</option>
              <option value="none">none</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)}
              className="rounded" />
            <span>Internal (no external access)</span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" onClick={onClose}>Cancel</AlertDialogCancel>
            <AlertDialogAction type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
              Create
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function Networks() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: networks, isLoading } = useQuery({
    queryKey: ["networks"],
    queryFn: listAllNetworks,
  });

  const create = useMutation({
    mutationFn: createNetwork,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["networks"] }); toast.success("Network created"); },
    onError: (e: Error) => toast.error(e.message || "Failed to create network"),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteNetwork(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["networks"] });
      toast.success("Network deleted");
      setDeletingId(null);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to delete network"),
  });

  const projects = [...new Set((networks ?? []).map((n) => n.associatedProject).filter(Boolean))].sort();
  const filtered = (networks ?? []).filter((n) => {
    const matchSearch = !search || n.name.toLowerCase().includes(search.toLowerCase());
    const matchProject = !projectFilter || n.associatedProject === projectFilter;
    return matchSearch && matchProject;
  });

  const networkToDelete = networks?.find((n) => n.id === deletingId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Network className="size-4 text-muted-foreground" />
            Networks
          </h1>
          <p className="text-xs text-muted-foreground">{networks?.length ?? 0} networks total</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus className="size-3.5" /> New network
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search networks…"
            className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50"
        >
          <option value="">All projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div
          className="grid gap-x-3 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider px-4 py-2.5 border-b border-border"
          style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 80px 80px 44px" }}
        >
          <span>Name</span>
          <span>Driver</span>
          <span>Scope</span>
          <span>Project</span>
          <span>Internal</span>
          <span>Status</span>
          <span />
        </div>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
            <span className="live-dot size-1.5 rounded-full bg-primary inline-block mr-2" />
            Loading…
          </div>
        ) : !filtered.length ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
            {networks?.length ? "No networks match your filters." : "No networks found."}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {filtered.map((n: NetworkSummary) => (
              <div
                key={n.id}
                className="grid gap-x-3 items-center text-xs px-4 py-2.5 hover:bg-secondary/30 transition-colors"
                style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 80px 80px 44px" }}
              >
                <div
                  className="flex items-center gap-2 min-w-0 cursor-pointer"
                  onClick={() => navigate(`/networks/${n.id}`)}
                >
                  <Network className="size-3 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate hover:text-primary">{n.name}</span>
                </div>
                <span className="font-mono text-muted-foreground">{n.driver}</span>
                <span className="text-muted-foreground">{n.scope}</span>
                <span className="text-muted-foreground truncate">{n.associatedProject || "—"}</span>
                <span className="text-muted-foreground">{n.internal ? "Yes" : "No"}</span>
                <InUseBadge inUse={n.inUse} />
                <div className="flex justify-end">
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeletingId(n.id); }}
                    title="Delete network"
                    className="rounded p-1 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <CreateNetworkDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={async (req) => { await create.mutateAsync(req); }}
      />

      <AlertDialog open={deletingId !== null} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete network?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the network{" "}
              <span className="font-mono font-medium">{networkToDelete?.name ?? deletingId}</span>.
              {networkToDelete?.inUse && (
                <span className="block mt-2 text-yellow-600 dark:text-yellow-400">
                  ⚠ This network is currently in use.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingId !== null && del.mutate(deletingId)}
              className="bg-destructive text-white hover:opacity-90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
