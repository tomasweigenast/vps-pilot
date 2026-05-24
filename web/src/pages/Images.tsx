import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Search, Trash2, Loader2, Hammer, Plus, X, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { listAllImages, deleteImage, startImageBuild } from "@/api/docker";
import type { BuildSpec } from "@/api/docker";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { ImageSummary } from "@/types";
function buildWsUrl(path: string): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${path}`;
}

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

// ─── Build Dialog ─────────────────────────────────────────────────────────────

interface BuildArg { key: string; value: string }

function BuildImageDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();

  // Form state
  const [dockerfile, setDockerfile] = useState("FROM alpine:latest\nRUN echo \"Hello, World!\"\n");
  const [tags, setTags] = useState("myimage:latest");
  const [target, setTarget] = useState("");
  const [noCache, setNoCache] = useState(false);
  const [buildArgs, setBuildArgs] = useState<BuildArg[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Streaming state
  const [buildId, setBuildId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Connect WS when we have a buildId
  useEffect(() => {
    if (!buildId) return;
    const ws = new WebSocket(buildWsUrl(`/api/ws/images/build/${buildId}`));
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const evt = msg.data as { stream?: string; error?: string; done?: boolean };
        if (evt.stream) {
          setLogs((prev) => [...prev, evt.stream!]);
        }
        if (evt.error) {
          setBuildError(evt.error);
          setDone(true);
        }
        if (evt.done) {
          setDone(true);
          qc.invalidateQueries({ queryKey: ["images"] });
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      setBuildError("WebSocket error");
      setDone(true);
    };

    return () => ws.close();
  }, [buildId, qc]);

  const startBuild = useMutation({
    mutationFn: () => {
      const spec: BuildSpec = {
        dockerfileContent: dockerfile,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        target: target || undefined,
        noCache,
        buildArgs: buildArgs.reduce<Record<string, string>>((acc, a) => {
          if (a.key) acc[a.key] = a.value;
          return acc;
        }, {}),
      };
      return startImageBuild(spec);
    },
    onSuccess: (data) => {
      setBuildId(data.buildId);
      setLogs([]);
      setDone(false);
      setBuildError(null);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to start build"),
  });

  const addBuildArg = () => setBuildArgs((prev) => [...prev, { key: "", value: "" }]);
  const removeBuildArg = (i: number) => setBuildArgs((prev) => prev.filter((_, idx) => idx !== i));
  const updateBuildArg = (i: number, field: "key" | "value", val: string) =>
    setBuildArgs((prev) => prev.map((a, idx) => idx === i ? { ...a, [field]: val } : a));

  const isBuilding = startBuild.isPending || (!!buildId && !done);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl bg-card border border-border rounded-xl shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Hammer className="size-4 text-muted-foreground" />
            Build Image
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Form area */}
          {!buildId && (
            <div className="p-5 space-y-4">
              {/* Dockerfile */}
              <div>
                <label className="block text-xs font-medium mb-1.5">Dockerfile</label>
                <textarea
                  value={dockerfile}
                  onChange={(e) => setDockerfile(e.target.value)}
                  rows={12}
                  className="w-full font-mono text-xs rounded-md border border-border bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-primary/50 resize-y"
                  placeholder="FROM alpine:latest&#10;RUN echo hello"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-xs font-medium mb-1.5">
                  Tags <span className="text-muted-foreground font-normal">(comma-separated)</span>
                </label>
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="myapp:latest, myapp:v1.0"
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>

              {/* Advanced */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showAdvanced ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  Advanced options
                </button>

                {showAdvanced && (
                  <div className="mt-3 space-y-3 pl-3 border-l border-border">
                    {/* Target */}
                    <div>
                      <label className="block text-xs font-medium mb-1">Target stage</label>
                      <input
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                        placeholder="(optional multi-stage target)"
                        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </div>

                    {/* No cache */}
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={noCache}
                        onChange={(e) => setNoCache(e.target.checked)}
                        className="rounded border-border"
                      />
                      <span className="text-xs">--no-cache</span>
                    </label>

                    {/* Build args */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium">Build args</label>
                        <button
                          type="button"
                          onClick={addBuildArg}
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Plus className="size-3" /> Add
                        </button>
                      </div>
                      {buildArgs.map((a, i) => (
                        <div key={i} className="flex gap-2 mb-1.5">
                          <input
                            value={a.key}
                            onChange={(e) => updateBuildArg(i, "key", e.target.value)}
                            placeholder="ARG_NAME"
                            className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:ring-1 focus:ring-primary/50"
                          />
                          <input
                            value={a.value}
                            onChange={(e) => updateBuildArg(i, "value", e.target.value)}
                            placeholder="value"
                            className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:ring-1 focus:ring-primary/50"
                          />
                          <button
                            type="button"
                            onClick={() => removeBuildArg(i)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Build output */}
          {buildId && (
            <div className="p-5">
              <div className="rounded-lg border border-border bg-zinc-950 p-3 h-72 overflow-y-auto font-mono text-xs leading-5">
                {logs.map((line, i) => (
                  <span key={i} className={cn(
                    "block whitespace-pre-wrap break-all",
                    line.toLowerCase().includes("error") ? "text-red-400" : "text-zinc-300"
                  )}>
                    {line}
                  </span>
                ))}
                {!done && (
                  <span className="inline-flex items-center gap-1 text-zinc-500 text-xs">
                    <Loader2 className="size-3 animate-spin" /> Building…
                  </span>
                )}
                {done && buildError && (
                  <span className="block text-red-400 font-semibold mt-2">✗ Build failed: {buildError}</span>
                )}
                {done && !buildError && (
                  <span className="block text-green-400 font-semibold mt-2">✓ Build successful</span>
                )}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {done ? "Close" : "Cancel"}
          </button>
          {!buildId && (
            <button
              onClick={() => startBuild.mutate()}
              disabled={isBuilding || !dockerfile.trim()}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none transition-opacity"
            >
              {isBuilding ? <Loader2 className="size-3.5 animate-spin" /> : <Hammer className="size-3.5" />}
              Build
            </button>
          )}
          {buildId && done && !buildError && (
            <button
              onClick={() => { setBuildId(null); setLogs([]); setDone(false); setBuildError(null); }}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Build again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function Images() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showBuild, setShowBuild] = useState(false);

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
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <ImageIcon className="size-4 text-muted-foreground" />
              Images
            </h1>
            <p className="text-xs text-muted-foreground">{images?.length ?? 0} images total</p>
          </div>
          <div className="flex items-center gap-2">
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
            <button
              onClick={() => setShowBuild(true)}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <Hammer className="size-3.5" />
              Build image
            </button>
          </div>
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

      {showBuild && <BuildImageDialog onClose={() => setShowBuild(false)} />}
    </>
  );
}
