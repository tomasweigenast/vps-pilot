import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  listProjects, startProject, stopProject, deleteProject, createProject, updateProject,
} from "@/api/projects";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";
import { Play, Square, Trash2, ScrollText, Plus, X, ChevronRight } from "lucide-react";

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

const projectSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9-]+$/),
  composeContent: z.string().min(1),
});
type PF = z.infer<typeof projectSchema>;

function ProjectDialog({
  project,
  onClose,
}: {
  project?: Project;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<PF>({
    resolver: zodResolver(projectSchema),
    defaultValues: project ? { name: project.name } : undefined,
  });

  const onSubmit = async (data: PF) => {
    try {
      if (project) {
        await updateProject(project.name, { name: project.name, composeContent: data.composeContent });
        toast.success("Project updated");
      } else {
        await createProject({ name: data.name, composeContent: data.composeContent });
        toast.success("Project created");
      }
      qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    } catch {
      toast.error("Failed to save project");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">{project ? "Edit project" : "New project"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</label>
            <input
              {...register("name")}
              disabled={!!project}
              placeholder="my-app"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
            />
            {errors.name && <p className="text-xs text-destructive">Lowercase letters, numbers and dashes only</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Compose content</label>
            <textarea
              {...register("composeContent")}
              rows={10}
              placeholder={"services:\n  app:\n    image: nginx"}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 resize-none"
            />
            {errors.composeContent && <p className="text-xs text-destructive">Required</p>}
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity">
              {isSubmitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const start = useMutation({
    mutationFn: () => startProject(project.name),
    onSuccess: () => { toast.success("Started"); qc.invalidateQueries({ queryKey: ["projects"] }); },
    onError: () => toast.error("Failed to start"),
  });
  const stop = useMutation({
    mutationFn: () => stopProject(project.name),
    onSuccess: () => { toast.success("Stopped"); qc.invalidateQueries({ queryKey: ["projects"] }); },
    onError: () => toast.error("Failed to stop"),
  });
  const del = useMutation({
    mutationFn: () => deleteProject(project.name),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["projects"] }); },
    onError: () => toast.error("Failed to delete"),
  });

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-5 space-y-4 hover:border-border/80 transition-colors">
        {/* Header */}
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

        {/* Containers */}
        {project.containers?.length > 0 && (
          <div className="rounded-lg bg-secondary/40 p-3 space-y-1.5">
            {project.containers.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-mono truncate max-w-[60%]">{c.name}</span>
                <span className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] font-medium",
                  c.state === "running" ? "bg-green-500/10 text-green-400" : "bg-zinc-700/50 text-zinc-400"
                )}>{c.state}</span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => start.mutate()}
            disabled={start.isPending || project.status === "running"}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-40 transition-colors"
          >
            <Play className="size-3" /> Start
          </button>
          <button
            onClick={() => stop.mutate()}
            disabled={stop.isPending || project.status === "stopped"}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-40 transition-colors"
          >
            <Square className="size-3" /> Stop
          </button>
          <Link
            to={`/projects/${project.name}/logs`}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
          >
            <ScrollText className="size-3" /> Logs
          </Link>
          <button
            onClick={() => setEditOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors ml-auto"
          >
            Edit
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={del.isPending}
            className="flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-xs text-destructive/80 hover:text-destructive hover:border-destructive/60 disabled:opacity-40 transition-colors"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>

      {editOpen && <ProjectDialog project={project} onClose={() => setEditOpen(false)} />}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-2xl shadow-black/60 space-y-4">
            <h2 className="text-sm font-semibold">Delete {project.name}?</h2>
            <p className="text-sm text-muted-foreground">This will remove the project configuration. Running containers may not be stopped.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(false)} className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
              <button onClick={() => { del.mutate(); setConfirmDelete(false); }} className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity">Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function Projects() {
  const { data, isLoading } = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const [newOpen, setNewOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">{data?.length ?? 0} projects</p>
        </div>
        <button
          onClick={() => setNewOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus className="size-4" /> New project
        </button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-44 rounded-xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      ) : !data?.length ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 py-16 text-center">
          <p className="text-sm text-muted-foreground">No projects found</p>
          <button onClick={() => setNewOpen(true)} className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus className="size-3" /> Create one
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => <ProjectCard key={p.name} project={p} />)}
        </div>
      )}

      {newOpen && <ProjectDialog onClose={() => setNewOpen(false)} />}
    </div>
  );
}
