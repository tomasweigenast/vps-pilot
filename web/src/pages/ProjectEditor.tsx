import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Save, Loader2 } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  getProject,
  createProject,
  updateProject,
  upsertProjectFile,
  deleteProjectFile,
  type ProjectFile,
} from "@/api/projects";

interface EnvEntry {
  key: string;
  value: string;
}

interface FileEntry {
  filename: string;
  content: string;
  toDelete?: boolean;
}

export function ProjectEditor() {
  const { name } = useParams<{ name: string }>();
  const isEdit = !!name;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [projectName, setProjectName] = useState("");
  const [composeContent, setComposeContent] = useState(
    "services:\n  app:\n    image: nginx\n"
  );
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [originalFiles, setOriginalFiles] = useState<ProjectFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [activeFile, setActiveFile] = useState<number | null>(null);

  const { data: projectData } = useQuery({
    queryKey: ["project", name],
    queryFn: () => getProject(name!),
    enabled: isEdit,
    staleTime: 0,
  });

  useEffect(() => {
    if (!projectData) return;
    setProjectName(projectData.name);
    setComposeContent(projectData.compose ?? "");
    setEnvEntries(
      Object.entries(projectData.envVars ?? {}).map(([key, value]) => ({
        key,
        value,
      }))
    );
    const fileEntries: FileEntry[] = (projectData.files ?? []).map(
      (f: ProjectFile) => ({ filename: f.filename, content: f.content })
    );
    setFiles(fileEntries);
    setOriginalFiles(projectData.files ?? []);
  }, [projectData]);

  const handleSave = useCallback(async () => {
    if (!projectName.trim()) {
      toast.error("Project name is required");
      return;
    }
    if (!composeContent.trim()) {
      toast.error("Compose content is required");
      return;
    }

    setSaving(true);
    try {
      const env = Object.fromEntries(
        envEntries
          .filter((e) => e.key.trim())
          .map((e) => [e.key.trim(), e.value])
      );

      if (isEdit) {
        await updateProject(name!, { name: name!, composeContent, env });
      } else {
        await createProject({ name: projectName, composeContent, env });
      }

      const targetName = isEdit ? name! : projectName;

      const originalNames = new Set(originalFiles.map((f) => f.filename));
      const currentNames = new Set(
        files.filter((f) => !f.toDelete).map((f) => f.filename)
      );

      for (const orig of originalFiles) {
        if (!currentNames.has(orig.filename)) {
          await deleteProjectFile(targetName, orig.filename);
        }
      }

      for (const f of files) {
        if (f.toDelete) continue;
        const orig = originalFiles.find((o) => o.filename === f.filename);
        if (!orig || orig.content !== f.content) {
          await upsertProjectFile(targetName, f.filename, f.content);
        }
      }

      for (const f of files) {
        if (f.toDelete || originalNames.has(f.filename)) continue;
        await upsertProjectFile(targetName, f.filename, f.content);
      }

      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(isEdit ? "Project updated" : "Project created");
      navigate("/projects");
    } catch {
      toast.error("Failed to save project");
    } finally {
      setSaving(false);
    }
  }, [
    isEdit,
    name,
    projectName,
    composeContent,
    envEntries,
    files,
    originalFiles,
    qc,
    navigate,
  ]);

  const addEnvEntry = () =>
    setEnvEntries((prev) => [...prev, { key: "", value: "" }]);

  const removeEnvEntry = (i: number) =>
    setEnvEntries((prev) => prev.filter((_, idx) => idx !== i));

  const updateEnvEntry = (i: number, field: "key" | "value", val: string) =>
    setEnvEntries((prev) =>
      prev.map((e, idx) => (idx === i ? { ...e, [field]: val } : e))
    );

  const addFile = () => {
    const newIdx = files.length;
    setFiles((prev) => [...prev, { filename: "", content: "" }]);
    setActiveFile(newIdx);
  };

  const removeFile = (i: number) => {
    setFiles((prev) =>
      prev.map((f, idx) => (idx === i ? { ...f, toDelete: true } : f))
    );
    if (activeFile === i) setActiveFile(null);
  };

  const updateFileField = (
    i: number,
    field: "filename" | "content",
    val: string
  ) =>
    setFiles((prev) =>
      prev.map((f, idx) => (idx === i ? { ...f, [field]: val } : f))
    );

  const visibleFiles = files.filter((f) => !f.toDelete);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 57px)" }}>
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/projects")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h1 className="text-sm font-semibold">
            {isEdit ? `Edit — ${name}` : "New project"}
          </h1>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Save
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel — compose editor */}
        <div className="flex flex-col flex-1 min-w-0 border-r border-border">
          {!isEdit && (
            <div className="border-b border-border px-4 py-3 shrink-0">
              <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                Project name
              </label>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="my-app"
                className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
            </div>
          )}

          <div className="px-4 pt-3 pb-1 shrink-0">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              docker-compose.yml
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            <CodeMirror
              value={composeContent}
              height="100%"
              theme={oneDark}
              extensions={[yaml()]}
              onChange={setComposeContent}
              style={{ height: "100%", fontSize: 13 }}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                autocompletion: true,
              }}
            />
          </div>
        </div>

        {/* Right panel — env vars + files */}
        <div className="w-80 flex flex-col min-h-0 overflow-y-auto shrink-0">
          {/* Environment variables */}
          <div className="border-b border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Environment variables
              </span>
              <button
                onClick={addEnvEntry}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="size-3" /> Add
              </button>
            </div>

            {envEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 italic">
                No variables
              </p>
            ) : (
              <div className="space-y-2">
                {envEntries.map((entry, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <input
                      value={entry.key}
                      onChange={(e) => updateEnvEntry(i, "key", e.target.value)}
                      placeholder="KEY"
                      className="w-[42%] rounded border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary"
                    />
                    <input
                      value={entry.value}
                      onChange={(e) =>
                        updateEnvEntry(i, "value", e.target.value)
                      }
                      placeholder="value"
                      className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary"
                    />
                    <button
                      onClick={() => removeEnvEntry(i)}
                      className="text-muted-foreground/60 hover:text-destructive transition-colors"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Extra files */}
          <div className="p-4 space-y-3 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Extra files
              </span>
              <button
                onClick={addFile}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="size-3" /> Add
              </button>
            </div>

            {visibleFiles.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 italic">
                No extra files
              </p>
            ) : (
              <div className="space-y-3">
                {files.map((file, i) => {
                  if (file.toDelete) return null;
                  return (
                    <div
                      key={i}
                      className="rounded-lg border border-border bg-card/40 overflow-hidden"
                    >
                      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-secondary/30">
                        <input
                          value={file.filename}
                          onChange={(e) =>
                            updateFileField(i, "filename", e.target.value)
                          }
                          placeholder="nginx.conf"
                          className="flex-1 bg-transparent text-xs font-mono outline-none text-foreground placeholder:text-muted-foreground/50"
                        />
                        <button
                          onClick={() => removeFile(i)}
                          className="text-muted-foreground/60 hover:text-destructive transition-colors shrink-0"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                      {activeFile === i ? (
                        <textarea
                          value={file.content}
                          onChange={(e) =>
                            updateFileField(i, "content", e.target.value)
                          }
                          rows={6}
                          className="w-full bg-background px-2 py-1.5 text-xs font-mono outline-none resize-none"
                          placeholder="File content…"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setActiveFile(i)}
                          className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {file.content
                            ? `${file.content.split("\n").length} lines — click to edit`
                            : "Click to edit…"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
