import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Search, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { listAllImages, deleteImage } from "@/api/docker";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { ImageSummary } from "@/types";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

export function Images() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: images, isLoading } = useQuery({
    queryKey: ["images"],
    queryFn: listAllImages,
  });

  const removeMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await deleteImage(id);
      }
    },
    onSuccess: () => {
      toast.success(`Removed ${selected.size} image${selected.size !== 1 ? "s" : ""}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["images"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to remove image(s)"),
  });

  const filtered = (images ?? []).filter((img) => {
    if (!search) return true;
    const tags = img.repoTags?.join(" ") ?? "";
    return tags.toLowerCase().includes(search.toLowerCase()) || img.id.includes(search);
  });

  const deletableSelected = [...selected].filter((id) => {
    const img = images?.find((i) => i.id === id);
    return img && !img.inUse;
  });

  function toggleSelect(id: string, inUse: boolean) {
    if (inUse) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const deletable = filtered.filter((img) => !img.inUse).map((img) => img.id);
    if (deletable.every((id) => selected.has(id))) {
      setSelected((prev) => {
        const next = new Set(prev);
        deletable.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => new Set([...prev, ...deletable]));
    }
  }

  const deletableFiltered = filtered.filter((img) => !img.inUse);
  const allFilteredDeletableSelected = deletableFiltered.length > 0 && deletableFiltered.every((img) => selected.has(img.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <ImageIcon className="size-4 text-muted-foreground" />
            Images
          </h1>
          <p className="text-xs text-muted-foreground">{images?.length ?? 0} images total</p>
        </div>
        {selected.size > 0 && (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={deletableSelected.length === 0 || removeMutation.isPending}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            {removeMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Delete {deletableSelected.length} image{deletableSelected.length !== 1 ? "s" : ""}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search images…"
            className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div
          className="grid gap-x-3 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider px-4 py-2.5 border-b border-border items-center"
          style={{ gridTemplateColumns: "24px minmax(0,3fr) minmax(0,1fr) minmax(0,1fr) 90px 80px" }}
        >
          <input
            type="checkbox"
            checked={allFilteredDeletableSelected}
            onChange={toggleAll}
            className="rounded border-border"
          />
          <span>Tags</span>
          <span>Image ID</span>
          <span>Size</span>
          <span>Created</span>
          <span>Status</span>
        </div>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
            <span className="live-dot size-1.5 rounded-full bg-primary inline-block mr-2" />
            Loading…
          </div>
        ) : !filtered.length ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
            {images?.length ? "No images match your search." : "No images found."}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {filtered.map((img: ImageSummary) => {
              const tags = img.repoTags?.filter((t) => t !== "<none>:<none>") ?? [];
              const isChecked = selected.has(img.id);
              return (
                <div
                  key={img.id}
                  className={cn(
                    "grid gap-x-3 items-center text-xs px-4 py-2.5 transition-colors",
                    img.inUse ? "opacity-80" : "hover:bg-secondary/30 cursor-pointer",
                    isChecked && "bg-primary/5"
                  )}
                  style={{ gridTemplateColumns: "24px minmax(0,3fr) minmax(0,1fr) minmax(0,1fr) 90px 80px" }}
                  onClick={() => toggleSelect(img.id, img.inUse)}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={img.inUse}
                    onChange={() => toggleSelect(img.id, img.inUse)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-border disabled:opacity-30"
                  />
                  <div className="flex items-center gap-2 min-w-0">
                    <ImageIcon className="size-3 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      {tags.length > 0 ? (
                        tags.map((t) => (
                          <div key={t} className="font-mono truncate">{t}</div>
                        ))
                      ) : (
                        <span className="text-muted-foreground/50 italic">&lt;none&gt;</span>
                      )}
                    </div>
                  </div>
                  <span className="font-mono text-muted-foreground">{img.id}</span>
                  <span className="text-muted-foreground">{formatBytes(img.size)}</span>
                  <span className="text-muted-foreground">{formatDate(img.created)}</span>
                  <span className={cn(
                    "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset w-fit",
                    img.inUse
                      ? "bg-green-500/10 text-green-400 ring-green-500/20"
                      : "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20"
                  )}>
                    <span className={cn("size-1.5 rounded-full", img.inUse ? "bg-green-400" : "bg-zinc-500")} />
                    {img.inUse ? "In use" : "Unused"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Remove ${deletableSelected.length} image${deletableSelected.length !== 1 ? "s" : ""}?`}
        description="This will permanently remove the selected images from the host. This action cannot be undone."
        confirmLabel="Remove"
        destructive
        onConfirm={() => { setConfirmDelete(false); removeMutation.mutate(deletableSelected); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
