import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ImageIcon, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { listProjectImages, deleteImage } from "@/api/docker";
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

export function ProjectImages() {
  const { name } = useParams<{ name: string }>();
  const qc = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<ImageSummary | null>(null);

  const { data: images, isLoading } = useQuery({
    queryKey: ["project-images", name],
    queryFn: () => listProjectImages(name!),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => deleteImage(id),
    onSuccess: () => {
      toast.success("Image removed");
      qc.invalidateQueries({ queryKey: ["project-images", name] });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to remove image"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to={`/projects/${name}`} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <ImageIcon className="size-4 text-muted-foreground" />
            Images
          </h1>
          <p className="text-xs text-muted-foreground">{name}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div
          className="grid gap-x-3 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider px-4 py-2.5 border-b border-border"
          style={{ gridTemplateColumns: "minmax(0,3fr) minmax(0,1fr) minmax(0,1fr) 80px 48px" }}
        >
          <span>Tags</span>
          <span>Image ID</span>
          <span>Size</span>
          <span>Created</span>
          <span />
        </div>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
            <span className="live-dot size-1.5 rounded-full bg-primary inline-block mr-2" />
            Loading…
          </div>
        ) : !images?.length ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
            No images found for this project.
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {images.map((img: ImageSummary) => {
              const tags = img.repoTags?.filter((t) => t !== "<none>:<none>") ?? [];
              return (
                <div
                  key={img.id}
                  className="grid gap-x-3 items-center text-xs px-4 py-2.5"
                  style={{ gridTemplateColumns: "minmax(0,3fr) minmax(0,1fr) minmax(0,1fr) 80px 48px" }}
                >
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
                  <button
                    onClick={() => setDeleteTarget(img)}
                    disabled={removeMutation.isPending}
                    className={cn(
                      "rounded p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-30 disabled:pointer-events-none",
                    )}
                    title="Remove image"
                  >
                    {removeMutation.isPending && removeMutation.variables === img.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove image?"
        description={`This will remove the image "${deleteTarget?.repoTags?.[0] ?? deleteTarget?.id}". Containers using this image will continue running, but new containers cannot be started from it.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => deleteTarget && removeMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
