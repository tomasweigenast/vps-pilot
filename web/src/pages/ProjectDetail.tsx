import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Play, Square, RotateCcw, ScrollText, Pencil, Save, Loader2,
  Plus, Trash2, FileText, Cpu, MemoryStick, FolderOpen, Terminal, Download,
  LayoutList, Code,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { StreamLanguage } from "@codemirror/language";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Extension } from "@codemirror/state";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ComposeBuilder } from "@/components/compose/ComposeBuilder";
import { parseCompose, serializeCompose } from "@/components/compose/serializer";
import type { ComposeFile } from "@/components/compose/types";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  getProject, updateProject, deleteProject,
  upsertProjectFile, deleteProjectFile,
  stopProject, restartProject, containerAction,
  checkProjectUpdates,
  type ProjectFile,
} from "@/api/projects";
import { listWebhooks, createProjectWebhook, createServiceWebhook, deleteWebhook, patchProjectConfig } from "@/api/webhooks";
import type { Webhook } from "@/api/webhooks";
import { listProjectSecrets, setProjectSecrets, listSecrets } from "@/api/secrets";
import type { Secret, ProjectSecret } from "@/types";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { ContainerStat, WSMessage, Project } from "@/types";
import { listProjects } from "@/api/projects";
import { listProjectNetworks, listProjectVolumes, listProjectImages } from "@/api/docker";
import { Network, HardDrive, ImageIcon, RefreshCw, Webhook as WebhookIcon, Copy, Check, Trash2 as WebhookTrash, ArrowUpCircle, LockKeyhole, X as XIcon } from "lucide-react";
import { UpdatesDialog } from "@/components/UpdatesDialog";

// ─── helpers ─────────────────────────────────────────────────────────────────

const statsCache: Record<string, Record<string, ContainerStat>> = {};

const statusDot: Record<string, string> = {
  running: "bg-green-500",
  stopped: "bg-zinc-600",
  partial: "bg-yellow-500",
  unknown: "bg-zinc-600",
};
const statusLabel: Record<string, string> = {
  running: "Running",
  stopped: "Stopped",
  partial: "Partial",
  unknown: "Unknown",
};

function formatDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function getLanguageExtension(filename: string): Extension[] {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "yml" || ext === "yaml") return [yaml()];
  if (ext === "json") return [json()];
  if (ext === "md" || ext === "markdown") return [markdown()];
  if (ext === "sql") return [sql()];
  if (ext === "conf" || ext === "nginx") return [StreamLanguage.define(nginx)];
  if (ext === "env" || ext === "properties" || ext === "ini") return [StreamLanguage.define(properties)];
  return [];
}

interface EnvEntry { key: string; value: string; }
interface FileEntry { filename: string; content: string; toDelete?: boolean; }
type ActiveTab = "compose" | number;

// ─── ContainerRow ─────────────────────────────────────────────────────────────

// ─── ProjectResourceCards ─────────────────────────────────────────────────────

function InUseDot({ inUse }: { inUse: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset",
      inUse ? "bg-green-500/10 text-green-400 ring-green-500/20" : "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20"
    )}>
      <span className={cn("size-1.5 rounded-full", inUse ? "bg-green-400" : "bg-zinc-500")} />
      {inUse ? "In use" : "Unused"}
    </span>
  );
}

function ProjectResourceCards({ projectName }: { projectName: string }) {
  const { data: networks } = useQuery({
    queryKey: ["project-networks", projectName],
    queryFn: () => listProjectNetworks(projectName),
  });
  const { data: volumes } = useQuery({
    queryKey: ["project-volumes", projectName],
    queryFn: () => listProjectVolumes(projectName),
  });
  const { data: images } = useQuery({
    queryKey: ["project-images", projectName],
    queryFn: () => listProjectImages(projectName),
  });

  if (!networks?.length && !volumes?.length && !images?.length) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Networks card */}
      {!!networks?.length && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-medium flex items-center gap-2">
              <Network className="size-4 text-muted-foreground" />
              Networks
            </span>
            <span className="text-xs text-muted-foreground">{networks.length}</span>
          </div>
          <div className="divide-y divide-border/50">
            {networks.map((n) => (
              <Link
                key={n.id}
                to={`/networks/${n.id}`}
                className="flex items-center justify-between px-4 py-2 text-xs hover:bg-secondary/30 transition-colors"
              >
                <span className="font-medium truncate flex-1 min-w-0">{n.name}</span>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <span className="text-muted-foreground font-mono">{n.driver}</span>
                  <InUseDot inUse={n.inUse} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Volumes card */}
      {!!volumes?.length && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-medium flex items-center gap-2">
              <HardDrive className="size-4 text-muted-foreground" />
              Volumes
            </span>
            <span className="text-xs text-muted-foreground">{volumes.length}</span>
          </div>
          <div className="divide-y divide-border/50">
            {volumes.map((v) => (
              <Link
                key={v.name}
                to={`/volumes/${encodeURIComponent(v.name)}`}
                className="flex items-center justify-between px-4 py-2 text-xs hover:bg-secondary/30 transition-colors"
              >
                <span className="font-medium truncate flex-1 min-w-0">{v.name}</span>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <span className="text-muted-foreground font-mono">{v.driver}</span>
                  <InUseDot inUse={v.inUse} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Images card */}
      {!!images?.length && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-medium flex items-center gap-2">
              <ImageIcon className="size-4 text-muted-foreground" />
              Images
            </span>
            <span className="text-xs text-muted-foreground">{images.length}</span>
          </div>
          <div className="divide-y divide-border/50">
            {images.map((img) => {
              const tag = img.repoTags?.find((t) => t !== "<none>:<none>") ?? img.id;
              return (
                <Link
                  key={img.id}
                  to="/images"
                  className="flex items-center justify-between px-4 py-2 text-xs hover:bg-secondary/30 transition-colors"
                >
                  <span className="font-mono truncate flex-1 min-w-0">{tag}</span>
                  <div className="ml-2 shrink-0">
                    <InUseDot inUse={img.inUse} />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ContainerRow ─────────────────────────────────────────────────────────────

const healthColors: Record<string, string> = {
  healthy: "bg-green-500",
  unhealthy: "bg-red-500",
  starting: "bg-yellow-500",
};

function ContainerRow({
  projectName,
  container,
  stat,
}: {
  projectName: string;
  container: { id: string; name: string; image: string; state: string; status: string; ports: string; health: string };
  stat?: ContainerStat;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isRunning = container.state === "running";
  const [confirm, setConfirm] = useState<"stop" | "restart" | null>(null);

  const action = useMutation({
    mutationFn: (act: "start" | "stop" | "restart") =>
      containerAction(projectName, container.id, act),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
    onError: (e: Error, act) => toast.error(e.message || `Failed to ${act} container`),
  });

  const shortName = container.name.replace(projectName + "-", "");

  return (
    <>
      <div
        className="grid items-center gap-x-3 text-xs py-1.5 px-3 rounded-lg hover:bg-secondary/30 transition-colors"
        style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,2fr) minmax(0,1fr) 80px minmax(0,1fr) 60px 72px 180px 104px" }}
      >
        {/* Name */}
        <div
          className="flex items-center gap-2 min-w-0 cursor-pointer"
          onClick={() => navigate(`/projects/${projectName}/containers/${container.id}`)}
        >
          <span className="font-mono text-foreground/80 truncate hover:text-primary hover:underline">{shortName}</span>
        </div>

        {/* Image */}
        <span className="font-mono text-muted-foreground/60 truncate min-w-0" title={container.image}>{container.image || "—"}</span>

        {/* Ports */}
        <span className="font-mono text-muted-foreground/60 truncate">{container.ports || "—"}</span>

        {/* State badge */}
        {(() => {
          const stateLower = container.state?.toLowerCase() ?? "";
          const badge = containerStateBadge[stateLower];
          return (
            <div className="flex items-center gap-1">
              <span className={cn("size-1.5 rounded-full shrink-0", badge?.dot ?? "bg-zinc-500")} />
              <span className="text-muted-foreground/60 truncate">{badge?.label ?? container.state ?? "—"}</span>
            </div>
          );
        })()}

        {/* Running since */}
        <span className="text-muted-foreground/60 truncate" title={container.status}>
          {container.status || "—"}
        </span>

        {/* Health */}
        <div className="flex items-center gap-1">
          {container.health && container.health !== "none" ? (
            <span className={cn("size-1.5 rounded-full shrink-0", healthColors[container.health] ?? "bg-zinc-500")} />
          ) : (
            <span className="size-1.5 rounded-full shrink-0 bg-zinc-600 opacity-30" />
          )}
          <span className="text-muted-foreground/60 capitalize truncate">{container.health !== "none" ? container.health || "—" : "—"}</span>
        </div>

        {/* CPU */}
        <div className="flex items-center gap-1 text-muted-foreground justify-end">
          <Cpu className="size-3 opacity-50 shrink-0" />
          <span className="tabular-nums w-10 text-right">
            {stat && isRunning ? `${stat.cpuPercent.toFixed(1)}%` : "—"}
          </span>
        </div>

        {/* Memory */}
        <div className="flex items-center gap-1 text-muted-foreground justify-end">
          <MemoryStick className="size-3 opacity-50 shrink-0" />
          <span className="tabular-nums w-44 text-right">
            {stat && isRunning ? `${formatBytes(stat.memUsed)} / ${formatBytes(stat.memLimit)}` : "—"}
          </span>
        </div>
        <TooltipProvider>
          <div className="flex items-center gap-0.5 justify-end">
            <Tooltip>
              <TooltipTrigger render={
                <button onClick={() => action.mutate("start")} disabled={action.isPending || isRunning}
                  className="rounded p-1 text-muted-foreground hover:text-green-400 hover:bg-green-400/10 disabled:opacity-30 disabled:pointer-events-none transition-colors" />
              }><Play className="size-3" /></TooltipTrigger>
              <TooltipContent>Start</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <button onClick={() => setConfirm("restart")} disabled={action.isPending || !isRunning}
                  className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:pointer-events-none transition-colors" />
              }><RotateCcw className="size-3" /></TooltipTrigger>
              <TooltipContent>Restart</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <button onClick={() => setConfirm("stop")} disabled={action.isPending || !isRunning}
                  className="rounded p-1 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 disabled:opacity-30 disabled:pointer-events-none transition-colors" />
              }><Square className="size-3" /></TooltipTrigger>
              <TooltipContent>Stop</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <Link to={`/projects/${projectName}/containers/${container.id}/files`}
                  className="rounded p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" />
              }><FolderOpen className="size-3" /></TooltipTrigger>
              <TooltipContent>Browse Files</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <Link to={`/projects/${projectName}/containers/${container.id}/shell`}
                  className={cn("rounded p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors", !isRunning && "pointer-events-none opacity-30")} />
              }><Terminal className="size-3" /></TooltipTrigger>
              <TooltipContent>Shell</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
      <ConfirmDialog open={confirm === "stop"}
        title={`Stop ${shortName}?`} description="The container will be stopped. You can start it again at any time."
        confirmLabel="Stop" onConfirm={() => { action.mutate("stop"); setConfirm(null); }} destructive onCancel={() => setConfirm(null)} />
      <ConfirmDialog open={confirm === "restart"}
        title={`Restart ${shortName}?`} description="The container will be restarted briefly causing a short interruption."
        confirmLabel="Restart" onConfirm={() => { action.mutate("restart"); setConfirm(null); }} onCancel={() => setConfirm(null)} />
    </>
  );
}

// ─── SimpleConfirm (used for project-level actions) ──────────────────────────

function SimpleConfirm({
  open, onOpenChange, title, description, confirmLabel, onConfirm, destructive,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string;
  description: string; confirmLabel: string; onConfirm: () => void; destructive?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}
            className={destructive ? "bg-destructive text-white hover:opacity-90" : undefined}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── DeleteConfirmDialog ──────────────────────────────────────────────────────

function DeleteConfirmDialog({
  open, projectName, onConfirm, onCancel,
}: {
  open: boolean; projectName: string; onConfirm: () => void; onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) { setValue(""); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {projectName}?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3 text-left">
              <p>
                This will permanently delete all project files, stop all containers, and
                remove all volumes and networks. <strong className="text-foreground">This cannot be undone.</strong>
              </p>
              <div className="space-y-1.5">
                <p className="text-sm">Type <span className="font-mono font-semibold text-foreground">{projectName}</span> to confirm:</p>
                <input
                  ref={inputRef}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && value === projectName) onConfirm(); }}
                  placeholder={projectName}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:border-destructive"
                />
              </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={value !== projectName}
            className="bg-destructive text-white hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none">
            Delete everything
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Container state badge ───────────────────────────────────────────────────

const containerStateBadge: Record<string, { dot: string; label: string }> = {
  running:    { dot: "bg-green-500",  label: "Running" },
  exited:     { dot: "bg-red-500",    label: "Stopped" },
  dead:       { dot: "bg-red-600",    label: "Dead" },
  created:    { dot: "bg-zinc-500",   label: "Created" },
  restarting: { dot: "bg-yellow-500", label: "Restarting" },
  paused:     { dot: "bg-blue-400",   label: "Paused" },
  removing:   { dot: "bg-orange-400", label: "Removing" },
};

// ─── RepullDialog ─────────────────────────────────────────────────────────────

// Deploy state is lifted to ProjectDetail so it survives dialog dismissal.
interface DeployState {
  deploying: boolean;
  logs: string[];
  action?: "deploy" | "repull_current" | "pull_new";
  wsRef: React.RefObject<WebSocket | null>;
  start: (projectName: string, action: "deploy" | "repull_current" | "pull_new", withRollback?: boolean) => void;
  cancel: () => void;
  reset: () => void;
}

function useDeployState(onSuccess?: () => void): DeployState {
  const [deploying, setDeploying] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [action, setAction] = useState<"deploy" | "repull_current" | "pull_new">();
  const wsRef = useRef<WebSocket | null>(null);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  function start(projectName: string, deployAction: "deploy" | "repull_current" | "pull_new", withRollback?: boolean) {
    setDeploying(true);
    setAction(deployAction);
    setLogs([]);
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const params = new URLSearchParams({ action: deployAction });
    if (deployAction === "pull_new" && withRollback) params.set("rollback", "true");
    const url = `${proto}://${window.location.host}/api/ws/projects/${projectName}/deploy?${params}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const evt = msg.data ?? msg;
        if (evt.line) setLogs((prev) => [...prev, evt.line]);
        if (evt.status) setLogs((prev) => [...prev, `[${msg.type ?? evt.type}] ${evt.status}${evt.error ? ": " + evt.error : ""}`]);
        if (msg.type === "done") {
          setDeploying(false);
          if (evt.success) {
            setLogs((prev) => [...prev, "✓ Completed successfully"]);
            onSuccessRef.current?.();
          } else if (evt.error) {
            setLogs((prev) => [...prev, "✗ " + evt.error]);
          }
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => { setDeploying(false); setLogs((prev) => [...prev, "WebSocket error"]); };
    ws.onclose = () => { setDeploying(false); };
  }

  function cancel() {
    wsRef.current?.close();
    setDeploying(false);
    setLogs([]);
  }

  function reset() {
    setLogs([]);
    setDeploying(false);
    setAction(undefined);
  }

  return { deploying, logs, action, wsRef, start, cancel, reset };
}

function RepullDialog({
  open,
  projectName,
  deploy,
  onClose,
}: {
  open: boolean;
  projectName: string;
  deploy: DeployState;
  onClose: () => void;
}) {
  const [action, setAction] = useState<"repull_current" | "pull_new">("pull_new");
  const [withRollback, setWithRollback] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [deploy.logs]);

  // When the dialog opens fresh (no active deploy), reset logs.
  useEffect(() => {
    if (open && !deploy.deploying && deploy.logs.length === 0) {
      // already clean
    }
  }, [open, deploy.deploying, deploy.logs.length]);

  const showLogs = deploy.deploying || deploy.logs.length > 0;

  if (!open) return null;

  return (
    <AlertDialog open={open} onOpenChange={(o) => {
      if (!o) {
        // Always allow dismiss — deploy keeps running in background.
        onClose();
      }
    }}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{deploy.action === "deploy" ? "Starting project" : "Update images"}</AlertDialogTitle>
          {!showLogs && deploy.action !== "deploy" && (
            <AlertDialogDescription>Choose how to update this project's containers.</AlertDialogDescription>
          )}
        </AlertDialogHeader>

        {!showLogs ? (
          deploy.action === "deploy" ? (
            // Simple start dialog (before logs start)
            <div className="space-y-4 mt-2">
              <p className="text-sm text-muted-foreground">
                This will start the project using <code className="bg-background/80 px-2 py-1 rounded text-xs">docker compose up</code>. Images will be pulled if needed.
              </p>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
              </AlertDialogFooter>
            </div>
          ) : (
            // Update images dialog
            <div className="space-y-4 mt-2">
              {/* Action choice */}
              <div className="space-y-2">
                {(
                  [
                    { value: "repull_current" as const, label: "Recreate with current images", desc: "Force-recreate containers using already-cached local images. No network pull." },
                    { value: "pull_new" as const,        label: "Pull & update to latest versions", desc: "Check registry for newer tags, pull, and redeploy. Supports rollback." },
                  ] as const
                ).map(({ value, label, desc }) => (
                  <label
                    key={value}
                    className={cn(
                      "flex gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors",
                      action === value ? "border-primary bg-primary/5" : "border-border hover:border-border/80"
                    )}
                  >
                    <input
                      type="radio"
                      name="repull-action"
                      value={value}
                      checked={action === value}
                      onChange={() => setAction(value)}
                      className="mt-0.5 accent-primary"
                    />
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                    </div>
                  </label>
                ))}
              </div>

              {/* Rollback option (pull_new only) */}
              {action === "pull_new" && (
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={withRollback}
                    onChange={(e) => setWithRollback(e.target.checked)}
                    className="accent-primary"
                  />
                  <span className="text-sm">Enable automatic rollback if deploy fails</span>
                </label>
              )}

              <AlertDialogFooter>
                <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => deploy.start(projectName, action, withRollback)}>
                  <RefreshCw className="size-3.5 mr-1.5" />
                  Start update
                </AlertDialogAction>
              </AlertDialogFooter>
            </div>
          )
        ) : (
          <div className="mt-2">
            <div className="rounded-lg bg-zinc-950 border border-border h-64 overflow-y-auto p-3 font-mono text-xs text-zinc-300">
              {deploy.logs.map((l, i) => <div key={i}>{l}</div>)}
              {deploy.deploying && (
                <div className="flex items-center gap-1.5 text-muted-foreground mt-1">
                  <Loader2 className="size-3 animate-spin" /> Running…
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
            <AlertDialogFooter className="mt-4">
              {deploy.deploying ? (
                <>
                  <AlertDialogCancel onClick={onClose}>
                    Dismiss
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => { deploy.cancel(); onClose(); }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Cancel update
                  </AlertDialogAction>
                </>
              ) : (
                <AlertDialogCancel onClick={() => { deploy.reset(); onClose(); }}>
                  Close
                </AlertDialogCancel>
              )}
            </AlertDialogFooter>
          </div>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── WebhooksSection ──────────────────────────────────────────────────────────

function WebhookRow({
  hook,
  label,
  onDelete,
}: {
  hook: Webhook;
  label: string;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = hook.serviceName
    ? `${window.location.origin}/webhooks/${hook.projectName}/${hook.serviceName}/${hook.token}`
    : `${window.location.origin}/webhooks/${hook.projectName}/${hook.token}`;

  function copy() {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-lg border border-border bg-secondary/10 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <WebhookIcon className="size-3 text-muted-foreground" />
          {label}
        </span>
        <div className="flex items-center gap-1">
          {hook.lastCalledAt && (
            <span className="text-[10px] text-muted-foreground/50">
              {hook.callCount}× · last {new Date(hook.lastCalledAt).toLocaleDateString()}
            </span>
          )}
          <button onClick={onDelete} title="Delete webhook" className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
            <WebhookTrash className="size-3" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 rounded bg-zinc-900 px-2.5 py-1.5">
        <span className="font-mono text-[11px] text-zinc-300 truncate flex-1 min-w-0 select-all">{url}</span>
        <button onClick={copy} title="Copy URL" className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
          {copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ─── Secrets Section ─────────────────────────────────────────────────────────

function SecretsSection({ projectName }: { projectName: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [selectedSecretId, setSelectedSecretId] = useState<number | "">("");
  const [envVarName, setEnvVarName] = useState("");

  const { data: projectSecrets = [] } = useQuery({
    queryKey: ["project-secrets", projectName],
    queryFn: () => listProjectSecrets(projectName),
  });

  const { data: allSecrets = [] } = useQuery({
    queryKey: ["secrets"],
    queryFn: listSecrets,
    enabled: adding,
  });

  const setSecrets = useMutation({
    mutationFn: (secrets: Array<{ secretId: number; envVarName: string }>) =>
      setProjectSecrets(projectName, secrets),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-secrets", projectName] });
      toast.success("Secrets updated");
    },
    onError: (e: Error) => toast.error(e.message || "Failed to update secrets"),
  });

  function handleAdd() {
    if (!selectedSecretId || !envVarName.trim()) return;
    const current = projectSecrets.map((s: ProjectSecret) => ({
      secretId: s.secretId,
      envVarName: s.envVarName,
    }));
    setSecrets.mutate([...current, { secretId: Number(selectedSecretId), envVarName: envVarName.trim() }]);
    setAdding(false);
    setSelectedSecretId("");
    setEnvVarName("");
  }

  function handleRemove(secretId: number) {
    const updated = projectSecrets
      .filter((s: ProjectSecret) => s.secretId !== secretId)
      .map((s: ProjectSecret) => ({ secretId: s.secretId, envVarName: s.envVarName }));
    setSecrets.mutate(updated);
  }

  const assignedIds = new Set(projectSecrets.map((s: ProjectSecret) => s.secretId));
  const availableSecrets = allSecrets.filter((s: Secret) => !assignedIds.has(s.id));

  return (
    <div className="rounded-xl border border-border bg-card p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <LockKeyhole className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Secrets</h3>
          <span className="text-xs text-muted-foreground">({projectSecrets.length})</span>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1 text-xs text-primary hover:opacity-80 transition-opacity"
        >
          <Plus className="size-3" />
          Assign secret
        </button>
      </div>

      {adding && (
        <div className="mb-3 p-3 rounded-lg border border-border bg-secondary/20 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1">Secret</label>
              <select
                value={selectedSecretId}
                onChange={(e) => setSelectedSecretId(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Select a secret…</option>
                {availableSecrets.map((s: Secret) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1">Env var name</label>
              <input
                type="text"
                value={envVarName}
                onChange={(e) => setEnvVarName(e.target.value.toUpperCase())}
                placeholder="MY_SECRET"
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => { setAdding(false); setSelectedSecretId(""); setEnvVarName(""); }}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-secondary transition-colors">
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!selectedSecretId || !envVarName.trim() || setSecrets.isPending}
              className="text-xs rounded-md bg-primary px-3 py-1 text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none transition-opacity"
            >
              Assign
            </button>
          </div>
          {availableSecrets.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No unassigned secrets available.{" "}
              <a href="/secrets" className="text-primary hover:underline">Manage secrets →</a>
            </p>
          )}
        </div>
      )}

      {projectSecrets.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 italic">No secrets assigned to this project.</p>
      ) : (
        <div className="space-y-1">
          {projectSecrets.map((s: ProjectSecret) => (
            <div key={s.secretId} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
              <LockKeyhole className="size-3 text-muted-foreground shrink-0" />
              <span className="font-medium text-foreground">{s.secretName}</span>
              <span className="text-muted-foreground">→</span>
              <code className="font-mono text-muted-foreground">{s.envVarName}</code>
              <button
                onClick={() => handleRemove(s.secretId)}
                className="ml-auto text-muted-foreground hover:text-destructive transition-colors"
                title="Remove"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WebhooksSection({ projectName, containers }: { projectName: string; containers: { id: string; name: string; serviceName: string }[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: hooks = [] } = useQuery({
    queryKey: ["webhooks", projectName],
    queryFn: () => listWebhooks(projectName),
    enabled: open,
  });

  const createProject = useMutation({
    mutationFn: () => createProjectWebhook(projectName),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["webhooks", projectName] }); toast.success("Webhook created"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const createService = useMutation({
    mutationFn: (service: string) => createServiceWebhook(projectName, service),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["webhooks", projectName] }); toast.success("Webhook created"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: number) => deleteWebhook(projectName, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks", projectName] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const projectHook = hooks.find((h) => !h.serviceName);
  const serviceHooks = hooks.filter((h) => !!h.serviceName);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden mt-4">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-secondary/20 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          <WebhookIcon className="size-4 text-muted-foreground" />
          Webhooks
        </span>
        <span className={cn("text-xs text-muted-foreground transition-transform", open && "rotate-180")}>▼</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">POST to a webhook URL to trigger a pull-and-redeploy from CI/CD.</p>

          {/* Project-level */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">Project webhook</span>
              {!projectHook && (
                <button
                  onClick={() => createProject.mutate()}
                  disabled={createProject.isPending}
                  className="flex items-center gap-1 text-xs text-primary hover:opacity-80 transition-opacity"
                >
                  <Plus className="size-3" /> Create
                </button>
              )}
            </div>
            {projectHook ? (
              <WebhookRow hook={projectHook} label="project" onDelete={() => del.mutate(projectHook.id)} />
            ) : (
              <p className="text-xs text-muted-foreground/50 italic">No project webhook</p>
            )}
          </div>

          {/* Per-service */}
          {containers.length > 0 && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">Service webhooks</span>
              <div className="mt-1.5 space-y-2">
                {containers.map((c) => {
                  const svc = c.serviceName || c.name.replace(projectName + "-", "").replace(/-\d+$/, "");
                  const hook = serviceHooks.find((h) => h.serviceName === svc);
                  return (
                    <div key={c.id}>
                      {hook ? (
                        <WebhookRow hook={hook} label={svc} onDelete={() => del.mutate(hook.id)} />
                      ) : (
                        <div className="flex items-center justify-between gap-2 py-1.5 px-3 rounded-lg border border-dashed border-border text-xs">
                          <span className="font-mono text-muted-foreground">{svc}</span>
                          <button
                            onClick={() => createService.mutate(svc)}
                            disabled={createService.isPending}
                            className="flex items-center gap-1 text-xs text-primary hover:opacity-80 shrink-0"
                          >
                            <Plus className="size-3" /> Create webhook
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ProjectDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"stop" | "restart" | "delete" | null>(null);
  const [repullOpen, setRepullOpen] = useState(false);
  const [showUpdates, setShowUpdates] = useState(false);
  const [showRedeploy, setShowRedeploy] = useState(false);
  const deploy = useDeployState(() => {
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["project-updates", name] });
  });

  // editor state
  const [description, setDescription] = useState("");
  const [composeContent, setComposeContent] = useState("");
  const [composeMode, setComposeMode] = useState<"yaml" | "visual">("yaml");
  const [visualModel, setVisualModel] = useState<ComposeFile>({});
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [originalFiles, setOriginalFiles] = useState<ProjectFile[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>("compose");
  const [saving, setSaving] = useState(false);

  // Live project status (from list endpoint)
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: listProjects, refetchInterval: 5000 });
  const liveProject: Project | undefined = projects?.find((p) => p.name === name);

  // Update check (only when running)
  const { data: updateStatus } = useQuery({
    queryKey: ["project-updates", name],
    queryFn: () => checkProjectUpdates(name!),
    enabled: !!name && liveProject?.status === "running",
    staleTime: 0,
    refetchInterval: 10 * 60_000,
    retry: false,
  });

  // Detail data (compose, env, files)
  const { data: detail } = useQuery({
    queryKey: ["project", name],
    queryFn: () => getProject(name!),
    enabled: !!name,
    staleTime: 0,
  });

  // Container stats
  const [statsMap, setStatsMap] = useState<Record<string, ContainerStat>>(() => statsCache[name!] ?? {});
  const isActive = liveProject?.status !== "stopped";
  useWebSocket<WSMessage<ContainerStat[]>>(
    `/api/ws/projects/${name}/stats`,
    (msg) => {
      if (msg.type === "stats" && Array.isArray(msg.data)) {
        const next: Record<string, ContainerStat> = {};
        for (const s of msg.data) next[s.name] = s;
        statsCache[name!] = next;
        setStatsMap(next);
      }
    },
    isActive
  );

  /* eslint-disable react-hooks/set-state-in-effect */
  // Populate editor when detail loads — intentional setState, syncing server data into local editor state
  useEffect(() => {
    if (!detail) return;
    setDescription(detail.description ?? "");
    setComposeContent(detail.compose ?? "");
    setEnvEntries(Object.entries(detail.envVars ?? {}).map(([key, value]) => ({ key, value })));
    const fileEntries: FileEntry[] = (detail.files ?? []).map((f: ProjectFile) => ({
      filename: f.filename, content: f.content,
    }));
    setFiles(fileEntries);
    setOriginalFiles(detail.files ?? []);
  }, [detail]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Extract set of image references from a compose YAML string.
  const extractImages = (yaml: string): Set<string> => {
    const images = new Set<string>();
    for (const m of yaml.matchAll(/^\s+image:\s*(.+)$/gm)) {
      const img = m[1].trim().replace(/^['"]|['"]$/g, "");
      if (img) images.add(img);
    }
    return images;
  };

  const handleSave = useCallback(async () => {
    if (!composeContent.trim()) { toast.error("Compose content is required"); return; }
    setSaving(true);
    try {
      const env = Object.fromEntries(
        envEntries.filter((e) => e.key.trim()).map((e) => [e.key.trim(), e.value])
      );

      // Snapshot images before save to detect changes.
      const imagesBefore = extractImages(detail?.compose ?? "");
      const imagesAfter = extractImages(composeContent);
      const imagesChanged =
        imagesAfter.size !== imagesBefore.size ||
        [...imagesAfter].some((img) => !imagesBefore.has(img));

      await updateProject(name!, { name: name!, description, composeContent, env });

      const originalNames = new Set(originalFiles.map((f) => f.filename));
      const currentNames = new Set(files.filter((f) => !f.toDelete).map((f) => f.filename));
      for (const orig of originalFiles) {
        if (!currentNames.has(orig.filename)) await deleteProjectFile(name!, orig.filename);
      }
      for (const f of files) {
        if (f.toDelete) continue;
        const orig = originalFiles.find((o) => o.filename === f.filename);
        if (!orig || orig.content !== f.content) await upsertProjectFile(name!, f.filename, f.content);
      }
      for (const f of files) {
        if (f.toDelete || originalNames.has(f.filename)) continue;
        await upsertProjectFile(name!, f.filename, f.content);
      }

      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", name] });
      toast.success("Project updated");
      setEditing(false);

      // Offer to redeploy if images changed and project is running.
      if (imagesChanged && liveProject?.status === "running") {
        setShowRedeploy(true);
      }
    } catch {
      toast.error("Failed to save project");
    } finally {
      setSaving(false);
    }
  }, [name, description, composeContent, envEntries, files, originalFiles, qc, detail, liveProject]);

  const cancelEdit = () => {
    // Reset editor state from detail
    if (detail) {
      setDescription(detail.description ?? "");
      setComposeContent(detail.compose ?? "");
      setEnvEntries(Object.entries(detail.envVars ?? {}).map(([key, value]) => ({ key, value })));
      setFiles((detail.files ?? []).map((f: ProjectFile) => ({ filename: f.filename, content: f.content })));
      setOriginalFiles(detail.files ?? []);
    }
    setActiveTab("compose");
    setComposeMode("yaml");
    setVisualModel({});
    setEditing(false);
  };

  const stop = useMutation({
    mutationFn: () => stopProject(name!),
    onSuccess: () => { toast.success("Stopped"); qc.invalidateQueries({ queryKey: ["projects"] }); },
    onError: (e: Error) => toast.error(e.message || "Failed to stop"),
  });
  const restart = useMutation({
    mutationFn: () => restartProject(name!),
    onSuccess: () => { toast.success("Restarted"); qc.invalidateQueries({ queryKey: ["projects"] }); },
    onError: (e: Error) => toast.error(e.message || "Failed to restart"),
  });
  const del = useMutation({
    mutationFn: () => deleteProject(name!),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["projects"] }); navigate("/projects"); },
    onError: (e: Error) => toast.error(e.message || "Failed to delete"),
  });

  const addEnvEntry = () => setEnvEntries((prev) => [...prev, { key: "", value: "" }]);
  const removeEnvEntry = (i: number) => setEnvEntries((prev) => prev.filter((_, idx) => idx !== i));
  const updateEnvEntry = (i: number, field: "key" | "value", val: string) =>
    setEnvEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, [field]: val } : e)));

  const addFile = () => { const idx = files.length; setFiles((prev) => [...prev, { filename: "", content: "" }]); setActiveTab(idx); };
  const removeFile = (i: number) => { setFiles((prev) => prev.map((f, idx) => idx === i ? { ...f, toDelete: true } : f)); if (activeTab === i) setActiveTab("compose"); };
  const updateFileField = (i: number, field: "filename" | "content", val: string) =>
    setFiles((prev) => prev.map((f, idx) => idx === i ? { ...f, [field]: val } : f));

  const visibleFiles = files.map((f, i) => ({ ...f, originalIndex: i })).filter((f) => !f.toDelete);
  const activeFileEntry = typeof activeTab === "number" ? files[activeTab] : null;

  const status = liveProject?.status ?? "unknown";
  const containers = liveProject?.containers ?? [];

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/projects" className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight truncate">{name}</h1>
              {updateStatus?.hasUpdates && (
                <button
                  onClick={() => setShowUpdates(true)}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500 shrink-0 hover:bg-amber-500/20 transition-colors"
                >
                  <ArrowUpCircle className="size-2.5" />
                  Updates available
                </button>
              )}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={cn("size-1.5 rounded-full", statusDot[status] ?? "bg-zinc-600")} />
                <span className="text-xs text-muted-foreground">{statusLabel[status] ?? status}</span>
              </div>
            </div>
            {detail?.description && !editing && (
              <p className="text-sm text-muted-foreground mt-0.5">{detail.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={
                <button onClick={() => { deploy.start(name!, "deploy", false); setRepullOpen(true); }} disabled={status === "running" || deploy.deploying}
                  className="rounded-md border border-border p-2 text-muted-foreground hover:text-green-400 hover:border-green-400/40 disabled:opacity-40 disabled:pointer-events-none transition-colors" />
              }>{deploy.deploying && deploy.action === "deploy" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}</TooltipTrigger>
              <TooltipContent>Start</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <button onClick={() => setConfirm("restart")} disabled={restart.isPending || status === "stopped" || deploy.deploying}
                  className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-40 disabled:pointer-events-none transition-colors" />
              }><RotateCcw className="size-3.5" /></TooltipTrigger>
              <TooltipContent>Restart</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <button onClick={() => setConfirm("stop")} disabled={stop.isPending || status === "stopped" || deploy.deploying}
                  className="rounded-md border border-border p-2 text-muted-foreground hover:text-red-400 hover:border-red-400/40 disabled:opacity-40 disabled:pointer-events-none transition-colors" />
              }><Square className="size-3.5" /></TooltipTrigger>
              <TooltipContent>Stop</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <button
            onClick={() => setRepullOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
          >
            {deploy.deploying
              ? <><Loader2 className="size-3.5 animate-spin" /> Updating…</>
              : <><Download className="size-3.5" /> Update images</>
            }
          </button>

          <Link to={`/projects/${name}/logs`}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors">
            <ScrollText className="size-3.5" /> Logs
          </Link>

          {editing ? (
            <div className="flex items-center gap-2">
              <button onClick={cancelEdit}
                className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity">
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Save
              </button>
            </div>
          ) : (
            <button onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors">
              <Pencil className="size-3.5" /> Edit
            </button>
          )}

          <button onClick={() => setConfirm("delete")} disabled={del.isPending}
            title="Delete project"
            className="rounded-md border border-destructive/30 p-2 text-destructive/70 hover:text-destructive hover:border-destructive/60 disabled:opacity-40 transition-colors">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Info cards (read mode) */}
      {!editing && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            {[
              { label: "Created by", value: detail?.createdBy || "—" },
              { label: "Directory", value: liveProject?.dir ?? "—" },
              { label: "Created", value: detail ? formatDate(detail.createdAt) : "—" },
              { label: "Updated", value: detail ? formatDate(detail.updatedAt) : "—" },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <p className="text-sm font-medium truncate" title={value}>{value}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2.5 mb-6">
            <label className="flex items-center gap-2 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={detail?.removeStaleImages ?? false}
                onChange={async (e) => {
                  try {
                    await patchProjectConfig(name!, { removeStaleImages: e.target.checked });
                    qc.invalidateQueries({ queryKey: ["project", name] });
                  } catch (err: unknown) {
                    toast.error((err as Error).message || "Failed to update");
                  }
                }}
                className="accent-primary"
              />
              <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                Remove stale images after updates
              </span>
            </label>
            <span className="text-xs text-muted-foreground/50">
              Prunes old images no longer used by this project after each successful update
            </span>
          </div>
        </>
      )}

      {/* Edit mode */}
      {editing && (
        <div className="rounded-xl border border-border bg-card overflow-hidden mb-6" style={{ height: 520 }}>
          <div className="flex h-full">
            {/* Editor */}
            <div className="flex flex-col flex-1 min-w-0">
              {/* Description input */}
              <div className="border-b border-border px-4 py-2 shrink-0 flex items-center gap-3">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Description</span>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short project description (optional)"
                  className="flex-1 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground/50"
                />
              </div>

              {/* Tab bar */}
              <div className="flex items-center gap-0 border-b border-border bg-secondary/10 shrink-0 overflow-x-auto">
                <button onClick={() => setActiveTab("compose")}
                  className={cn("flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono border-r border-border whitespace-nowrap transition-colors",
                    activeTab === "compose" ? "bg-background text-foreground border-b-2 border-b-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/30")}>
                  <FileText className="size-3" />docker-compose.yml
                </button>
                {visibleFiles.map(({ originalIndex, filename }) => (
                  <button key={originalIndex} onClick={() => setActiveTab(originalIndex)}
                    className={cn("flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono border-r border-border whitespace-nowrap transition-colors",
                      activeTab === originalIndex ? "bg-background text-foreground border-b-2 border-b-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/30")}>
                    <FileText className="size-3" />{filename || "untitled"}
                  </button>
                ))}
                {/* Visual / YAML toggle — only when on the compose tab */}
                {activeTab === "compose" && (
                  <div className="ml-auto flex items-center gap-0 border-l border-border">
                    <button
                      onClick={() => {
                        if (composeMode === "yaml") {
                          setVisualModel(parseCompose(composeContent));
                          setComposeMode("visual");
                        }
                      }}
                      className={cn(
                        "flex items-center gap-1 px-3 py-2.5 text-xs transition-colors",
                        composeMode === "visual"
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                      )}
                      title="Visual editor"
                    >
                      <LayoutList className="size-3.5" />
                      Visual
                    </button>
                    <button
                      onClick={() => {
                        if (composeMode === "visual") {
                          setComposeContent(serializeCompose(visualModel));
                          setComposeMode("yaml");
                        }
                      }}
                      className={cn(
                        "flex items-center gap-1 px-3 py-2.5 text-xs transition-colors",
                        composeMode === "yaml"
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                      )}
                      title="YAML editor"
                    >
                      <Code className="size-3.5" />
                      YAML
                    </button>
                  </div>
                )}
              </div>

              {/* Editor area */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {activeTab === "compose" && composeMode === "visual" ? (
                  <ComposeBuilder
                    value={visualModel}
                    onChange={(cf) => {
                      setVisualModel(cf);
                      setComposeContent(serializeCompose(cf));
                    }}
                    projectEnvVars={detail?.envVars}
                  />
                ) : activeTab === "compose" ? (
                  <CodeMirror value={composeContent} height="100%" theme={oneDark} extensions={[yaml()]}
                    onChange={(val) => setComposeContent(val)} style={{ height: "100%", fontSize: 13 }}
                    basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: true }} />
                ) : activeFileEntry ? (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center gap-2 border-b border-border px-4 py-2 shrink-0 bg-secondary/10">
                      <span className="text-xs text-muted-foreground">Filename:</span>
                      <input value={activeFileEntry.filename}
                        onChange={(e) => updateFileField(activeTab as number, "filename", e.target.value)}
                        placeholder="e.g. config.yaml" className="flex-1 bg-transparent text-xs font-mono outline-none" />
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <CodeMirror value={activeFileEntry.content} height="100%" theme={oneDark}
                        extensions={getLanguageExtension(activeFileEntry.filename)}
                        onChange={(val) => updateFileField(activeTab as number, "content", val)}
                        style={{ height: "100%", fontSize: 13 }}
                        basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: true }} />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Right panel */}
            <div className="w-64 flex flex-col min-h-0 border-l border-border shrink-0">
              {/* Env vars */}
              <div className="border-b border-border p-3 space-y-2 overflow-y-auto max-h-[50%]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Env variables</span>
                  <button onClick={addEnvEntry} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <Plus className="size-3" /> Add
                  </button>
                </div>
                {envEntries.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60 italic">No variables</p>
                ) : (
                  <div className="space-y-1.5">
                    {envEntries.map((entry, i) => (
                      <div key={i} className="flex gap-1 items-center">
                        <input value={entry.key} onChange={(e) => updateEnvEntry(i, "key", e.target.value)}
                          placeholder="KEY" className="w-[42%] rounded border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary" />
                        <input value={entry.value} onChange={(e) => updateEnvEntry(i, "value", e.target.value)}
                          placeholder="value" className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary" />
                        <button onClick={() => removeEnvEntry(i)} className="text-muted-foreground/60 hover:text-destructive transition-colors">
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Extra files */}
              <div className="p-3 space-y-2 flex-1 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Extra files</span>
                  <button onClick={addFile} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <Plus className="size-3" /> Add
                  </button>
                </div>
                {visibleFiles.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60 italic">No extra files</p>
                ) : (
                  <div className="space-y-1">
                    {visibleFiles.map(({ originalIndex, filename }) => (
                      <div key={originalIndex}
                        className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors",
                          activeTab === originalIndex ? "bg-primary/10 text-primary" : "hover:bg-secondary/40 text-muted-foreground hover:text-foreground")}
                        onClick={() => setActiveTab(originalIndex)}>
                        <FileText className="size-3 shrink-0" />
                        <span className="text-xs font-mono flex-1 truncate">{filename || "untitled"}</span>
                        <button onClick={(e) => { e.stopPropagation(); removeFile(originalIndex); }}
                          className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0">
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Containers */}
      {containers.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-medium">Containers</span>
            <span className="text-xs text-muted-foreground">{containers.length} container{containers.length !== 1 ? "s" : ""}</span>
          </div>
          {/* Column headers */}
          <div
            className="grid items-center gap-x-3 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider px-3 py-1.5 border-b border-border"
            style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,2fr) minmax(0,1fr) 80px minmax(0,1fr) 60px 72px 180px 104px" }}
          >
            <span>Name</span>
            <span>Image</span>
            <span>Ports</span>
            <span>State</span>
            <span>Running since</span>
            <span>Health</span>
            <span className="text-right">CPU</span>
            <span className="text-right">Memory</span>
            <span />
          </div>
          <div className="px-2 py-2 space-y-0.5">
            {containers.map((c) => (
              <ContainerRow key={c.id} projectName={name!} container={c} stat={statsMap[c.name]} />
            ))}
          </div>
        </div>
      )}

      {/* Secrets */}
      <SecretsSection projectName={name!} />

      {/* Webhooks */}
      <WebhooksSection projectName={name!} containers={containers} />

      {/* Resource cards: Networks, Volumes, Images */}
      <div className="mt-4">
        <ProjectResourceCards projectName={name!} />
      </div>

      {/* Repull dialog */}
      <RepullDialog open={repullOpen} projectName={name!} deploy={deploy} onClose={() => setRepullOpen(false)} />

      {/* Confirm dialogs */}
      <SimpleConfirm open={confirm === "stop"} onOpenChange={(o) => !o && setConfirm(null)}
        title={`Stop ${name}?`} description="All containers in this project will be stopped."
        confirmLabel="Stop" onConfirm={() => { stop.mutate(); setConfirm(null); }} destructive />
      <SimpleConfirm open={confirm === "restart"} onOpenChange={(o) => !o && setConfirm(null)}
        title={`Restart ${name}?`} description="All containers will be restarted causing a brief interruption."
        confirmLabel="Restart" onConfirm={() => { restart.mutate(); setConfirm(null); }} />
      <DeleteConfirmDialog
        open={confirm === "delete"}
        projectName={name!}
        onConfirm={() => { del.mutate(); setConfirm(null); }}
        onCancel={() => setConfirm(null)} />
      {updateStatus && showUpdates && (
        <UpdatesDialog
          projectName={name!}
          status={updateStatus}
          open={showUpdates}
          onClose={() => setShowUpdates(false)}
          onDeploy={() => { setRepullOpen(true); }}
        />
      )}

      {/* Redeploy prompt after compose image change */}
      <SimpleConfirm
        open={showRedeploy}
        onOpenChange={(o) => !o && setShowRedeploy(false)}
        title="Redeploy with new images?"
        description="The compose file was saved with changed image references. Do you want to pull the new images and redeploy now?"
        confirmLabel="Pull & redeploy"
        onConfirm={() => {
          setShowRedeploy(false);
          setRepullOpen(true);
        }}
      />
    </>
  );
}
