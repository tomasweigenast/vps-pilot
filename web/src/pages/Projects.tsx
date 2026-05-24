import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { listProjects, startProject, stopProject, restartProject, checkProjectUpdates } from "@/api/projects";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";
import { Play, Square, RotateCcw, Plus, ScrollText, ArrowUpCircle } from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import { UpdatesDialog } from "@/components/UpdatesDialog";

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
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel, onConfirm, destructive,
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

function ProjectRow({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<"stop" | "restart" | null>(null);
  const [showUpdates, setShowUpdates] = useState(false);

  // Only check updates for running projects (lazy, background)
  const { data: updateStatus } = useQuery({
    queryKey: ["project-updates", project.name],
    queryFn: () => checkProjectUpdates(project.name),
    enabled: project.status === "running",
    staleTime: 5 * 60_000,   // 5 minutes
    refetchInterval: 10 * 60_000, // re-check every 10 minutes
    retry: false,
  });

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

  const isRunning = project.status === "running";
  const isStopped = project.status === "stopped";

  return (
    <>
      <tr className="group border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
        {/* Name + description */}
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            <Link
              to={`/projects/${project.name}`}
              className="font-medium text-sm text-blue-500 hover:text-blue-500 hover:underline underline-offset-2 transition-colors"
            >
              {project.name}
            </Link>
            {updateStatus?.hasUpdates && (
              <button
                onClick={() => setShowUpdates(true)}
                className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500 hover:bg-amber-500/20 transition-colors cursor-pointer"
              >
                <ArrowUpCircle className="size-2.5" />
                Updates available
              </button>
            )}
          </div>
          {project.description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{project.description}</p>
          )}
        </td>

        {/* Status */}
        <td className="py-3 px-4">
          <div className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full shrink-0", statusDot[project.status] ?? "bg-zinc-600")} />
            <span className="text-xs text-muted-foreground">{statusLabel[project.status] ?? project.status}</span>
          </div>
        </td>

        {/* Containers */}
        <td className="py-3 px-4 text-xs text-muted-foreground tabular-nums">
          {project.containers?.length ?? 0}
        </td>

        {/* Created by */}
        <td className="py-3 px-4 text-xs text-muted-foreground">
          {project.createdBy || "—"}
        </td>

        {/* Created at */}
        <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(project.createdAt)}
        </td>

        {/* Updated at */}
        <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(project.updatedAt)}
        </td>

        {/* Actions */}
        <td className="py-3 px-4">
          <TooltipProvider>
            <div className="flex items-center gap-0.5 justify-end">
              <Tooltip>
                <TooltipTrigger render={
                  <button
                    onClick={() => start.mutate()}
                    disabled={start.isPending || isRunning}
                    className="rounded p-1.5 text-muted-foreground hover:text-green-400 hover:bg-green-400/10 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  />
                }>
                  <Play className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>Start</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger render={
                  <button
                    onClick={() => setConfirm("restart")}
                    disabled={restart.isPending || isStopped}
                    className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  />
                }>
                  <RotateCcw className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>Restart</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger render={
                  <button
                    onClick={() => setConfirm("stop")}
                    disabled={stop.isPending || isStopped}
                    className="rounded p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  />
                }>
                  <Square className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>Stop</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger render={
                  <Link
                    to={`/projects/${project.name}/logs`}
                    className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  />
                }>
                  <ScrollText className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>Logs</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </td>
      </tr>

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
      {updateStatus && showUpdates && (
        <UpdatesDialog
          projectName={project.name}
          status={updateStatus}
          open={showUpdates}
          onClose={() => setShowUpdates(false)}
          onDeploy={() => restart.mutate()}
        />
      )}
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
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 rounded-lg border border-border bg-card animate-pulse" />
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
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/10">
                <th className="py-2.5 px-4 text-left text-xs font-medium text-muted-foreground">Project</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium text-muted-foreground">Containers</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium text-muted-foreground">Created by</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium text-muted-foreground">Created</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium text-muted-foreground">Updated</th>
                <th className="py-2.5 px-4 text-right text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => <ProjectRow key={p.name} project={p} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
