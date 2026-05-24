import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, Trash2, Loader2, RefreshCw, Box, Filter,
} from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { listContainers, createContainer, removeContainer } from "@/api/containers";
import type { StandaloneContainer, CreateContainerRequest, PortSpec } from "@/types";
import { cn } from "@/lib/utils";

function stateColor(state: string) {
  switch (state) {
    case "running": return "bg-green-500/20 text-green-500 border-green-500/30";
    case "exited": return "bg-red-500/20 text-red-600 border-red-500/30";
    case "paused": return "bg-yellow-500/20 text-yellow-600 border-yellow-500/30";
    case "created": return "bg-blue-500/20 text-blue-500 border-blue-500/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function formatPorts(ports: StandaloneContainer["ports"]): string {
  if (!ports || ports.length === 0) return "—";
  return ports
    .map((p) =>
      p.hostPort
        ? `${p.hostPort}→${p.containerPort}/${p.protocol}`
        : `${p.containerPort}/${p.protocol}`
    )
    .join(", ");
}

function formatCreated(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Create Container Dialog ─────────────────────────────────────────────────

function CreateContainerDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (req: CreateContainerRequest) => Promise<void>;
}) {
  const [image, setImage] = useState("");
  const [name, setName] = useState("");
  const [restartPolicy, setRestartPolicy] = useState("unless-stopped");
  const [envRaw, setEnvRaw] = useState("");
  const [portsRaw, setPortsRaw] = useState("");
  const [volumesRaw, setVolumesRaw] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!image.trim()) { toast.error("Image is required"); return; }

    const env = envRaw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l.includes("="));

    const ports: PortSpec[] = portsRaw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l)
      .map((l) => {
        // Formats: "8080:80", "8080:80/tcp", "80"
        const [hostPart, rest] = l.includes(":") ? l.split(":") : ["", l];
        const [containerPart, proto] = rest.includes("/") ? rest.split("/") : [rest, "tcp"];
        return { hostPort: hostPart, containerPort: containerPart, protocol: proto };
      });

    const volumes = volumesRaw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l);

    setSaving(true);
    try {
      await onSubmit({
        image: image.trim(),
        name: name.trim() || undefined,
        restartPolicy,
        env: env.length > 0 ? env : undefined,
        ports: ports.length > 0 ? ports : undefined,
        volumes: volumes.length > 0 ? volumes : undefined,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>New Container</AlertDialogTitle>
          <AlertDialogDescription>
            Create and start a standalone Docker container.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-xs text-muted-foreground">Image <span className="text-destructive">*</span></label>
              <input
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="nginx:latest"
                className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Name <span className="text-muted-foreground/50">(optional)</span></label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-nginx"
                className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Restart policy</label>
              <select
                value={restartPolicy}
                onChange={(e) => setRestartPolicy(e.target.value)}
                className="w-full rounded border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="no">No</option>
                <option value="always">Always</option>
                <option value="unless-stopped">Unless stopped</option>
                <option value="on-failure">On failure</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              Ports <span className="text-muted-foreground/50">(one per line: 8080:80 or 8080:80/tcp)</span>
            </label>
            <textarea
              value={portsRaw}
              onChange={(e) => setPortsRaw(e.target.value)}
              rows={2}
              placeholder={"8080:80\n443:443/tcp"}
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              Volumes <span className="text-muted-foreground/50">(one per line: /host:/container[:ro])</span>
            </label>
            <textarea
              value={volumesRaw}
              onChange={(e) => setVolumesRaw(e.target.value)}
              rows={2}
              placeholder={"/data:/data\n/etc/nginx:/etc/nginx:ro"}
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              Environment variables <span className="text-muted-foreground/50">(one per line: KEY=value)</span>
            </label>
            <textarea
              value={envRaw}
              onChange={(e) => setEnvRaw(e.target.value)}
              rows={3}
              placeholder={"DATABASE_URL=postgres://...\nNODE_ENV=production"}
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary resize-none"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel type="button" onClick={onClose}>Cancel</AlertDialogCancel>
            <AlertDialogAction type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
              Create & start
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function Containers() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(true);

  const { data: containers = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["containers", showAll],
    queryFn: () => listContainers(showAll),
    refetchInterval: 10_000,
  });

  const create = useMutation({
    mutationFn: createContainer,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["containers"] });
      toast.success("Container created and started");
    },
    onError: (e: Error) => toast.error(e.message || "Failed to create container"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeContainer(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["containers"] });
      toast.success("Container removed");
      setDeletingId(null);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to remove container"),
  });

  const containerToDelete = containers.find((c) => c.id === deletingId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Containers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            All host containers — compose and standalone
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAll((v) => !v)}
            title={showAll ? "Showing all containers" : "Showing running only"}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
              showAll
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
            )}
          >
            <Filter className="size-3.5" />
            {showAll ? "All" : "Running"}
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Plus className="size-3.5" /> New container
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : containers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 py-16 text-center">
          <Box className="size-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No containers found</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {showAll ? "Create a container to get started" : "No running containers"}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div
            className="grid items-center gap-3 px-4 py-2.5 border-b border-border bg-secondary/10 text-xs text-muted-foreground"
            style={{ gridTemplateColumns: "80px 1fr 2fr 1.5fr 1.5fr 1fr" }}
          >
            <span>ID</span>
            <span>Name</span>
            <span>Image</span>
            <span>Status</span>
            <span>Ports</span>
            <span className="text-right">Actions</span>
          </div>
          <div className="divide-y divide-border/50">
            {containers.map((c) => {
              const displayName = (c.names[0] ?? c.id).replace(/^\//, "");
              return (
                <div
                  key={c.id}
                  className="grid items-center gap-3 px-4 py-3 text-sm hover:bg-secondary/20 transition-colors"
                  style={{ gridTemplateColumns: "80px 1fr 2fr 1.5fr 1.5fr 1fr" }}
                >
                  <span className="font-mono text-xs text-muted-foreground">{c.id}</span>
                  <div>
                    <span className="font-medium text-xs truncate block">{displayName}</span>
                    {c.composeProject && (
                      <span className="text-[10px] text-muted-foreground/60 font-mono">
                        ↳ {c.composeProject}
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-xs text-muted-foreground truncate">{c.image}</span>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      stateColor(c.state)
                    )}>
                      {c.state}
                    </span>
                    <span className="text-xs text-muted-foreground/70 truncate hidden sm:block">
                      {c.status}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground truncate">
                    {formatPorts(c.ports)}
                  </span>
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      onClick={() => setDeletingId(c.id)}
                      title="Stop & remove"
                      className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <CreateContainerDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={async (req) => { await create.mutateAsync(req); }}
      />

      <AlertDialog open={deletingId !== null} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove container?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop and permanently remove{" "}
              <span className="font-mono font-medium">
                {(containerToDelete?.names[0] ?? deletingId ?? "").replace(/^\//, "")}
              </span>
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingId !== null && remove.mutate(deletingId)}
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
