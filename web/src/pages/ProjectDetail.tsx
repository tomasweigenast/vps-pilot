import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Play, Square, RotateCcw, ScrollText, Pencil, Save, Loader2,
  Plus, Trash2, FileText, Cpu, MemoryStick, FolderOpen, Terminal,
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
  startProject, stopProject, restartProject, containerAction,
  type ProjectFile,
} from "@/api/projects";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { ContainerStat, WSMessage, Project } from "@/types";
import { listProjects } from "@/api/projects";

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

function ContainerRow({
  projectName,
  container,
  stat,
}: {
  projectName: string;
  container: { id: string; name: string; image: string; state: string; status: string; ports: string };
  stat?: ContainerStat;
}) {
  const qc = useQueryClient();
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
        style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,2fr) minmax(0,1fr) minmax(0,0.7fr) 72px 130px 104px" }}
      >
        {/* Name */}
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("size-1.5 rounded-full shrink-0", isRunning ? "bg-green-500" : "bg-zinc-600")} />
          <span className="font-mono text-foreground/80 truncate">{shortName}</span>
        </div>

        {/* Image */}
        <span className="font-mono text-muted-foreground/60 truncate">{container.image || "—"}</span>

        {/* Ports */}
        <span className="font-mono text-muted-foreground/60 truncate">{container.ports || "—"}</span>

        {/* Container ID */}
        <span className="font-mono text-muted-foreground/50 truncate">{container.id}</span>

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
          <span className="tabular-nums w-24 text-right">
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

// ─── Main page ────────────────────────────────────────────────────────────────

export function ProjectDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"stop" | "restart" | "delete" | null>(null);

  // editor state
  const [description, setDescription] = useState("");
  const [composeContent, setComposeContent] = useState("");
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [originalFiles, setOriginalFiles] = useState<ProjectFile[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>("compose");
  const [saving, setSaving] = useState(false);

  // Live project status (from list endpoint)
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: listProjects, refetchInterval: 5000 });
  const liveProject: Project | undefined = projects?.find((p) => p.name === name);

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

  const handleSave = useCallback(async () => {
    if (!composeContent.trim()) { toast.error("Compose content is required"); return; }
    setSaving(true);
    try {
      const env = Object.fromEntries(
        envEntries.filter((e) => e.key.trim()).map((e) => [e.key.trim(), e.value])
      );
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
    } catch {
      toast.error("Failed to save project");
    } finally {
      setSaving(false);
    }
  }, [name, description, composeContent, envEntries, files, originalFiles, qc]);

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
    setEditing(false);
  };

  const start = useMutation({
    mutationFn: () => startProject(name!),
    onSuccess: () => { toast.success("Started"); qc.invalidateQueries({ queryKey: ["projects"] }); },
    onError: (e: Error) => toast.error(e.message || "Failed to start"),
  });
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
                <button onClick={() => start.mutate()} disabled={start.isPending || status === "running"}
                  className="rounded-md border border-border p-2 text-muted-foreground hover:text-green-400 hover:border-green-400/40 disabled:opacity-40 disabled:pointer-events-none transition-colors" />
              }><Play className="size-3.5" /></TooltipTrigger>
              <TooltipContent>Start</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <button onClick={() => setConfirm("restart")} disabled={restart.isPending || status === "stopped"}
                  className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-40 disabled:pointer-events-none transition-colors" />
              }><RotateCcw className="size-3.5" /></TooltipTrigger>
              <TooltipContent>Restart</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <button onClick={() => setConfirm("stop")} disabled={stop.isPending || status === "stopped"}
                  className="rounded-md border border-border p-2 text-muted-foreground hover:text-red-400 hover:border-red-400/40 disabled:opacity-40 disabled:pointer-events-none transition-colors" />
              }><Square className="size-3.5" /></TooltipTrigger>
              <TooltipContent>Stop</TooltipContent>
            </Tooltip>
          </TooltipProvider>

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
            className="rounded-md border border-destructive/30 p-2 text-destructive/70 hover:text-destructive hover:border-destructive/60 disabled:opacity-40 transition-colors">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Info cards (read mode) */}
      {!editing && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
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
              </div>

              {/* Editor area */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {activeTab === "compose" ? (
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
            style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,2fr) minmax(0,1fr) minmax(0,0.7fr) 72px 130px 104px" }}
          >
            <span>Name</span>
            <span>Image</span>
            <span>Ports</span>
            <span>Container ID</span>
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

      {/* Confirm dialogs */}
      <SimpleConfirm open={confirm === "stop"} onOpenChange={(o) => !o && setConfirm(null)}
        title={`Stop ${name}?`} description="All containers in this project will be stopped."
        confirmLabel="Stop" onConfirm={() => { stop.mutate(); setConfirm(null); }} destructive />
      <SimpleConfirm open={confirm === "restart"} onOpenChange={(o) => !o && setConfirm(null)}
        title={`Restart ${name}?`} description="All containers will be restarted causing a brief interruption."
        confirmLabel="Restart" onConfirm={() => { restart.mutate(); setConfirm(null); }} />
      <SimpleConfirm open={confirm === "delete"} onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete ${name}?`} description="This will remove the project configuration. Running containers may not be stopped."
        confirmLabel="Delete" onConfirm={() => { del.mutate(); setConfirm(null); }} destructive />
    </>
  );
}
