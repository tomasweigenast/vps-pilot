import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  listProjects, startProject, stopProject, restartProject, deleteProject, containerAction,
} from "@/api/projects";
import { useWebSocket } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";
import type { Project, ContainerStat, WSMessage } from "@/types";
import {
  Play, Square, RotateCcw, Trash2, ScrollText, Plus, Pencil,
  ChevronDown, ChevronUp, Cpu, MemoryStick, Terminal, FolderOpen,
} from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";

// Module-level cache so last-known stats survive card collapse/expand
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
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
          <AlertDialogAction
            onClick={onConfirm}
            className={destructive ? "bg-destructive text-white hover:opacity-90" : undefined}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ContainerRow({
  project,
  container,
  stat,
}: {
  project: Project;
  container: { id: string; name: string; image: string; state: string; status: string; ports: string };
  stat?: ContainerStat;
}) {
  const qc = useQueryClient();
  const isRunning = container.state === "running";
  const [confirm, setConfirm] = useState<"stop" | "restart" | null>(null);

  const action = useMutation({
    mutationFn: (act: "start" | "stop" | "restart") =>
      containerAction(project.name, container.id, act),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
    onError: (e: Error, act) => toast.error(e.message || `Failed to ${act} container`),
  });

  const shortName = container.name.replace(project.name + "-", "");

  return (
    <>
      <div className="grid items-center gap-x-2 text-xs py-1.5 px-3 rounded-lg hover:bg-secondary/30 transition-colors"
        style={{ gridTemplateColumns: "1fr 72px 160px 104px" }}
      >
        {/* Name + status dot */}
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              "size-1.5 rounded-full shrink-0",
              isRunning ? "bg-green-500" : "bg-zinc-600"
            )} />
            <span className="font-mono text-foreground/80 truncate">{shortName}</span>
          </div>
          {container.ports && (
            <span className="ml-3.5 font-mono text-[10px] text-muted-foreground/60 truncate">{container.ports}</span>
          )}
        </div>

        {/* CPU */}
        <div className="flex items-center gap-1 text-muted-foreground justify-end">
          <Cpu className="size-3 opacity-50 shrink-0" />
          <span className="tabular-nums w-10 text-right">
            {stat && isRunning ? `${stat.cpuPercent.toFixed(1)}%` : "—"}
          </span>
        </div>

        {/* Memory */}
        <div className="flex items-center justify-end gap-1 text-muted-foreground">
          <MemoryStick className="size-3 opacity-50 shrink-0" />
          {stat && isRunning ? (
            <>
              <span className="tabular-nums text-right" style={{ minWidth: "4.5rem" }}>{formatBytes(stat.memUsed)}</span>
              <span className="opacity-40">/</span>
              <span className="tabular-nums" style={{ minWidth: "3.5rem" }}>{formatBytes(stat.memLimit)}</span>
            </>
          ) : (
            <>
              <span className="tabular-nums text-right" style={{ minWidth: "4.5rem" }}>—</span>
              <span className="opacity-0">/</span>
              <span className="tabular-nums" style={{ minWidth: "3.5rem" }} />
            </>
          )}
        </div>

        {/* Actions — always visible */}
        <TooltipProvider>
          <div className="flex items-center gap-0.5 justify-end">
            <Tooltip>
              <TooltipTrigger render={
                <button
                  onClick={() => action.mutate("start")}
                  disabled={action.isPending || isRunning}
                  className="rounded p-1 text-muted-foreground hover:text-green-400 hover:bg-green-400/10 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                />
              }>
                <Play className="size-3" />
              </TooltipTrigger>
              <TooltipContent>Start</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <button
                  onClick={() => setConfirm("restart")}
                  disabled={action.isPending || !isRunning}
                  className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:pointer-events-none transition-colors"
                />
              }>
                <RotateCcw className="size-3" />
              </TooltipTrigger>
              <TooltipContent>Restart</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <button
                  onClick={() => setConfirm("stop")}
                  disabled={action.isPending || !isRunning}
                  className="rounded p-1 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                />
              }>
                <Square className="size-3" />
              </TooltipTrigger>
              <TooltipContent>Stop</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <Link
                  to={`/projects/${project.name}/containers/${container.id}/files`}
                  className="rounded p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                />
              }>
                <FolderOpen className="size-3" />
              </TooltipTrigger>
              <TooltipContent>Browse Files</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <Link
                  to={`/projects/${project.name}/containers/${container.id}/shell`}
                  className={cn(
                    "rounded p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors",
                    !isRunning && "pointer-events-none opacity-30"
                  )}
                />
              }>
                <Terminal className="size-3" />
              </TooltipTrigger>
              <TooltipContent>Shell</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      <ConfirmDialog
        open={confirm === "stop"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Stop ${shortName}?`}
        description="The container will be stopped. You can start it again at any time."
        confirmLabel="Stop"
        onConfirm={() => { action.mutate("stop"); setConfirm(null); }}
        destructive
      />
      <ConfirmDialog
        open={confirm === "restart"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Restart ${shortName}?`}
        description="The container will be restarted briefly causing a short interruption."
        confirmLabel="Restart"
        onConfirm={() => { action.mutate("restart"); setConfirm(null); }}
      />
    </>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<"stop" | "restart" | "delete" | null>(null);
  const [expanded, setExpanded] = useState(project.status === "running" || project.status === "partial");
  const projectName = project.name;
  const [statsMap, setStatsMap] = useState<Record<string, ContainerStat>>(() => {
    if (statsCache[projectName]) return statsCache[projectName];
    const zeros: Record<string, ContainerStat> = {};
    for (const c of project.containers ?? []) {
      zeros[c.name] = { name: c.name, cpuPercent: 0, memUsed: 0, memLimit: 0 };
    }
    return zeros;
  });

  useWebSocket<WSMessage<ContainerStat[]>>(
    `/api/ws/projects/${projectName}/stats`,
    (msg) => {
      if (msg.type === "stats" && Array.isArray(msg.data)) {
        const next: Record<string, ContainerStat> = {};
        for (const s of msg.data) next[s.name] = s;
        statsCache[projectName] = next;
        setStatsMap(next);
      }
    },
    expanded && project.status !== "stopped"
  );

  const start = useMutation({
    mutationFn: () => startProject(project.name),
    onSuccess: () => { toast.success("Started"); qc.invalidateQueries({ queryKey: ["projects"] }); },
    onError: (e: Error) => toast.error(e.message || "Failed to start"),
  });
  const stop = useMutation({
    mutationFn: () => stopProject(project.name),
    onSuccess: () => { toast.success("Stopped"); qc.invalidateQueries({ queryKey: ["projects"] }); },
    onError: (e: Error) => toast.error(e.message || "Failed to stop"),
  });
  const restart = useMutation({
    mutationFn: () => restartProject(project.name),
    onSuccess: () => { toast.success("Restarted"); qc.invalidateQueries({ queryKey: ["projects"] }); },
    onError: (e: Error) => toast.error(e.message || "Failed to restart"),
  });
  const del = useMutation({
    mutationFn: () => deleteProject(project.name),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["projects"] }); },
    onError: (e: Error) => toast.error(e.message || "Failed to delete"),
  });

  return (
    <>
      <div className="rounded-xl border border-border bg-card hover:border-border/80 transition-colors overflow-hidden">
        {/* Header */}
        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-medium text-sm truncate">{project.name}</h3>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{project.dir}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`size-1.5 rounded-full ${statusDot[project.status] ?? "bg-zinc-600"}`} />
              <span className="text-xs text-muted-foreground">{statusLabel[project.status] ?? project.status}</span>
            </div>
          </div>

          {/* Project-level actions */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => start.mutate()}
              disabled={start.isPending || project.status === "running"}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-40 transition-colors"
            >
              <Play className="size-3" /> Start
            </button>
            <button
              onClick={() => setConfirm("restart")}
              disabled={restart.isPending || project.status === "stopped"}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-40 transition-colors"
            >
              <RotateCcw className="size-3" /> Restart
            </button>
            <button
              onClick={() => setConfirm("stop")}
              disabled={stop.isPending || project.status === "stopped"}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-40 transition-colors"
            >
              <Square className="size-3" /> Stop
            </button>
            <Link
              to={`/projects/${project.name}/logs`}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
            >
              <ScrollText className="size-3" /> Logs
            </Link>
            <Link
              to={`/projects/${project.name}/edit`}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors ml-auto"
            >
              <Pencil className="size-3" /> Edit
            </Link>
            <button
              onClick={() => setConfirm("delete")}
              disabled={del.isPending}
              className="flex items-center gap-1 rounded-md border border-destructive/30 px-2.5 py-1.5 text-xs text-destructive/80 hover:text-destructive hover:border-destructive/60 disabled:opacity-40 transition-colors"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        </div>

        {/* Containers section */}
        {project.containers?.length > 0 && (
          <div className="border-t border-border">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/20 transition-colors"
            >
              <span>{project.containers.length} container{project.containers.length !== 1 ? "s" : ""}</span>
              {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            </button>

            {expanded && (
              <div className="px-2 pb-2 space-y-0.5">
                {project.containers.map((c) => (
                  <ContainerRow
                    key={c.id}
                    project={project}
                    container={c}
                    stat={statsMap[c.name]}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm === "stop"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Stop ${project.name}?`}
        description="All containers in this project will be stopped."
        confirmLabel="Stop"
        onConfirm={() => { stop.mutate(); setConfirm(null); }}
        destructive
      />
      <ConfirmDialog
        open={confirm === "restart"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Restart ${project.name}?`}
        description="All containers will be restarted causing a brief interruption."
        confirmLabel="Restart"
        onConfirm={() => { restart.mutate(); setConfirm(null); }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete ${project.name}?`}
        description="This will remove the project configuration. Running containers may not be stopped."
        confirmLabel="Delete"
        onConfirm={() => { del.mutate(); setConfirm(null); }}
        destructive
      />
    </>
  );
}

export function Projects() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">{data?.length ?? 0} projects</p>
        </div>
        <button
          onClick={() => navigate("/projects/new")}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus className="size-4" /> New project
        </button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-52 rounded-xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      ) : !data?.length ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 py-16 text-center">
          <p className="text-sm text-muted-foreground">No projects found</p>
          <button onClick={() => navigate("/projects/new")} className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus className="size-3" /> Create one
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((p) => <ProjectCard key={p.name} project={p} />)}
        </div>
      )}
    </div>
  );
}
