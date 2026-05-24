import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { HardDrive, Search, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { listAllVolumes, createVolume, deleteVolume } from "@/api/docker";
import type { VolumeSummary } from "@/types";
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

function CreateVolumeDialog({
  open, onClose, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (req: { name: string; driver: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [driver, setDriver] = useState("local");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), driver: driver.trim() || "local" });
      setName(""); setDriver("local");
      onClose();
    } finally { setSaving(false); }
  }

  if (!open) return null;
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Create volume</AlertDialogTitle>
          <AlertDialogDescription>Add a new Docker volume to the host.</AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-1">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Name <span className="text-muted-foreground/50">(leave blank for auto-generated)</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-volume"
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Driver</label>
            <input value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="local"
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
          </div>
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

export function Volumes() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const { data: volumes, isLoading } = useQuery({
    queryKey: ["volumes"],
    queryFn: listAllVolumes,
  });

  const create = useMutation({
    mutationFn: createVolume,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["volumes"] }); toast.success("Volume created"); },
    onError: (e: Error) => toast.error(e.message || "Failed to create volume"),
  });

  const del = useMutation({
    mutationFn: (name: string) => deleteVolume(name, false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["volumes"] });
      toast.success("Volume deleted");
      setDeletingName(null);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to delete volume"),
  });

  const projects = [...new Set((volumes ?? []).map((v) => v.associatedProject).filter(Boolean))].sort();
  const filtered = (volumes ?? []).filter((v) => {
    const matchSearch = !search || v.name.toLowerCase().includes(search.toLowerCase());
    const matchProject = !projectFilter || v.associatedProject === projectFilter;
    return matchSearch && matchProject;
  });

  const volumeToDelete = volumes?.find((v) => v.name === deletingName);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <HardDrive className="size-4 text-muted-foreground" />
            Volumes
          </h1>
          <p className="text-xs text-muted-foreground">{volumes?.length ?? 0} volumes total</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus className="size-3.5" /> New volume
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search volumes…"
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
          style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,2fr) 80px 44px" }}
        >
          <span>Name</span>
          <span>Driver</span>
          <span>Project</span>
          <span>Mountpoint</span>
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
            {volumes?.length ? "No volumes match your filters." : "No volumes found."}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {filtered.map((v: VolumeSummary) => (
              <div
                key={v.name}
                className="grid gap-x-3 items-center text-xs px-4 py-2.5 hover:bg-secondary/30 transition-colors"
                style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,2fr) 80px 44px" }}
              >
                <div
                  className="flex items-center gap-2 min-w-0 cursor-pointer"
                  onClick={() => navigate(`/volumes/${encodeURIComponent(v.name)}`)}
                >
                  <HardDrive className="size-3 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate hover:text-primary">{v.name}</span>
                </div>
                <span className="font-mono text-muted-foreground">{v.driver}</span>
                <span className="text-muted-foreground truncate">{v.associatedProject || "—"}</span>
                <span className="font-mono text-muted-foreground text-[10px] truncate" title={v.mountpoint}>{v.mountpoint || "—"}</span>
                <InUseBadge inUse={v.inUse} />
                <div className="flex justify-end">
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeletingName(v.name); }}
                    title="Delete volume"
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

      <CreateVolumeDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={async (req) => { await create.mutateAsync(req); }}
      />

      <AlertDialog open={deletingName !== null} onOpenChange={(o) => !o && setDeletingName(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete volume?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove volume{" "}
              <span className="font-mono font-medium">{deletingName}</span> and all its data.
              {volumeToDelete?.inUse && (
                <span className="block mt-2 text-yellow-600 dark:text-yellow-400">
                  ⚠ This volume is currently in use by running containers.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingName !== null && del.mutate(deletingName)}
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
