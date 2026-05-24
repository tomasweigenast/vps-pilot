import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Save, Loader2, FileText, LockKeyhole, Code, LayoutList } from "lucide-react";
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
  getProject,
  createProject,
  updateProject,
  upsertProjectFile,
  deleteProjectFile,
  type ProjectFile,
} from "@/api/projects";
import {
  listSecrets,
  listProjectSecrets,
  setProjectSecrets as saveProjectSecrets,
} from "@/api/secrets";
import type { ProjectSecret } from "@/types";

interface EnvEntry {
  key: string;
  value: string;
}

interface FileEntry {
  filename: string;
  content: string;
  toDelete?: boolean;
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

// activeTab: "compose" | file index (number)
type ActiveTab = "compose" | number;

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
  const [activeTab, setActiveTab] = useState<ActiveTab>("compose");
  const [dirtyTabs, setDirtyTabs] = useState<Set<ActiveTab>>(new Set());
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const [attachedSecrets, setAttachedSecrets] = useState<ProjectSecret[]>([]);
  const [composeMode, setComposeMode] = useState<"yaml" | "visual">("yaml");
  const [visualModel, setVisualModel] = useState<ComposeFile>({});

  const markDirty = (tab: ActiveTab) =>
    setDirtyTabs((prev) => new Set(prev).add(tab));
  const clearDirty = () => setDirtyTabs(new Set());

  const hasUnsavedChanges = dirtyTabs.size > 0;

  // Warn on browser refresh/close
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);

  const guardedNavigate = useCallback((to: string) => {
    if (hasUnsavedChanges) {
      setPendingNav(to);
      return;
    }
    navigateRef.current(to);
  }, [hasUnsavedChanges]);

  const { data: projectData } = useQuery({
    queryKey: ["project", name],
    queryFn: () => getProject(name!),
    enabled: isEdit,
    staleTime: 0,
  });

  const { data: availableSecrets = [] } = useQuery({
    queryKey: ["secrets"],
    queryFn: listSecrets,
    enabled: isEdit,
    staleTime: 30_000,
  });

  const { data: loadedProjectSecrets } = useQuery({
    queryKey: ["project-secrets", name],
    queryFn: () => listProjectSecrets(name!),
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

  useEffect(() => {
    if (loadedProjectSecrets) {
      setAttachedSecrets(loadedProjectSecrets);
    }
  }, [loadedProjectSecrets]);

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

      if (isEdit) {
        await saveProjectSecrets(
          targetName,
          attachedSecrets.map((s) => ({
            secretId: s.secretId,
            envVarName: s.envVarName,
          }))
        );
        qc.invalidateQueries({ queryKey: ["project-secrets", targetName] });
      }

      qc.invalidateQueries({ queryKey: ["projects"] });
      clearDirty();
      toast.success(isEdit ? "Project updated" : "Project created");
      navigateRef.current("/projects");
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
    attachedSecrets,
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
    setActiveTab(newIdx);
  };

  const removeFile = (i: number) => {
    setFiles((prev) =>
      prev.map((f, idx) => (idx === i ? { ...f, toDelete: true } : f))
    );
    if (activeTab === i) setActiveTab("compose");
  };

  const updateFileField = (
    i: number,
    field: "filename" | "content",
    val: string
  ) =>
    setFiles((prev) =>
      prev.map((f, idx) => (idx === i ? { ...f, [field]: val } : f))
    );

  const addAttachedSecret = (secretId: number, secretName: string) => {
    setAttachedSecrets((prev) => [
      ...prev,
      { secretId, secretName, envVarName: secretName },
    ]);
  };

  const removeAttachedSecret = (secretId: number) =>
    setAttachedSecrets((prev) => prev.filter((s) => s.secretId !== secretId));

  const updateAttachedSecretEnvVar = (secretId: number, envVarName: string) =>
    setAttachedSecrets((prev) =>
      prev.map((s) => (s.secretId === secretId ? { ...s, envVarName } : s))
    );

  const unattachedSecrets = availableSecrets.filter(
    (s) => !attachedSecrets.some((a) => a.secretId === s.id)
  );

  const visibleFiles = files
    .map((f, i) => ({ ...f, originalIndex: i }))
    .filter((f) => !f.toDelete);

  const activeFileEntry =
    typeof activeTab === "number" ? files[activeTab] : null;

  return (
    <>
    <div className="flex flex-col" style={{ height: "calc(100vh - 57px)" }}>
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => guardedNavigate("/projects")}
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
        {/* Main editor area */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Project name (create only) */}
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

          {/* Tab bar */}
          <div className="flex items-center gap-0 border-b border-border bg-secondary/10 shrink-0 overflow-x-auto">
            <button
              onClick={() => setActiveTab("compose")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono border-r border-border whitespace-nowrap transition-colors",
                activeTab === "compose"
                  ? "bg-background text-foreground border-b-2 border-b-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
              )}
            >
              <FileText className="size-3" />
              docker-compose.yml
              {dirtyTabs.has("compose") && (
                <span className="size-1.5 rounded-full bg-amber-400 shrink-0" />
              )}
            </button>
            {visibleFiles.map(({ originalIndex, filename }) => (
              <button
                key={originalIndex}
                onClick={() => setActiveTab(originalIndex)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono border-r border-border whitespace-nowrap transition-colors",
                  activeTab === originalIndex
                    ? "bg-background text-foreground border-b-2 border-b-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                )}
              >
                <FileText className="size-3" />
                {filename || "untitled"}
                {dirtyTabs.has(originalIndex) && (
                  <span className="size-1.5 rounded-full bg-amber-400 shrink-0" />
                )}
              </button>
            ))}
            {/* Visual/YAML toggle — only visible on the compose tab */}
            {activeTab === "compose" && (
              <div className="ml-auto flex items-center gap-0 border-l border-border">
                <button
                  onClick={() => {
                    if (composeMode === "yaml") {
                      // Switch to visual: parse and confirm
                      const parsed = parseCompose(composeContent);
                      setVisualModel(parsed);
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
                      // Serialize back to YAML
                      const yaml = serializeCompose(visualModel);
                      setComposeContent(yaml);
                      markDirty("compose");
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

          {/* Editor */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {activeTab === "compose" && composeMode === "visual" ? (
              <ComposeBuilder
                value={visualModel}
                onChange={(cf) => {
                  setVisualModel(cf);
                  // Keep composeContent in sync for saving
                  setComposeContent(serializeCompose(cf));
                  markDirty("compose");
                }}
              />
            ) : activeTab === "compose" ? (
              <CodeMirror
                value={composeContent}
                height="100%"
                theme={oneDark}
                extensions={[yaml()]}
                onChange={(val) => { setComposeContent(val); markDirty("compose"); }}
                style={{ height: "100%", fontSize: 13 }}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  autocompletion: true,
                }}
              />
            ) : activeFileEntry ? (
              <div className="flex flex-col h-full">
                {/* Filename bar */}
                <div className="flex items-center gap-2 border-b border-border px-4 py-2 shrink-0 bg-secondary/10">
                  <span className="text-xs text-muted-foreground">Filename:</span>
                  <input
                    value={activeFileEntry.filename}
                    onChange={(e) => {
                      updateFileField(activeTab as number, "filename", e.target.value);
                      markDirty(activeTab as number);
                    }}
                    placeholder="e.g. config.yaml, app.env"
                    className="flex-1 bg-transparent text-xs font-mono outline-none text-foreground placeholder:text-muted-foreground/50 focus:text-foreground"
                  />
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <CodeMirror
                    value={activeFileEntry.content}
                    height="100%"
                    theme={oneDark}
                    extensions={getLanguageExtension(activeFileEntry.filename)}
                    onChange={(val) => {
                      updateFileField(activeTab as number, "content", val);
                      markDirty(activeTab as number);
                    }}
                    style={{ height: "100%", fontSize: 13 }}
                    basicSetup={{
                      lineNumbers: true,
                      foldGutter: true,
                      autocompletion: true,
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Right panel — env vars + secrets + file list */}
        <div className="w-72 flex flex-col min-h-0 border-l border-border shrink-0 overflow-y-auto">
          {/* Environment variables */}
          <div className="border-b border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Env variables
              </span>
              <button
                onClick={addEnvEntry}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="size-3" /> Add
              </button>
            </div>

            {envEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 italic">No variables</p>
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
                      onChange={(e) => updateEnvEntry(i, "value", e.target.value)}
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

          {/* Secrets (edit mode only) */}
          {isEdit && (
            <div className="border-b border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <LockKeyhole className="size-3 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Secrets
                </span>
              </div>

              {attachedSecrets.length === 0 && availableSecrets.length === 0 ? (
                <p className="text-xs text-muted-foreground/60 italic">
                  No secrets defined yet
                </p>
              ) : (
                <>
                  {attachedSecrets.length > 0 && (
                    <div className="space-y-2.5">
                      {attachedSecrets.map((s) => (
                        <div key={s.secretId} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-medium text-foreground truncate max-w-[75%]">
                              {s.secretName}
                            </span>
                            <button
                              onClick={() => removeAttachedSecret(s.secretId)}
                              className="text-muted-foreground/50 hover:text-destructive transition-colors shrink-0"
                              title="Detach secret"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                          <input
                            value={s.envVarName}
                            onChange={(e) =>
                              updateAttachedSecretEnvVar(s.secretId, e.target.value)
                            }
                            placeholder="ENV_VAR_NAME"
                            title="Environment variable name injected into the container"
                            className="w-full rounded border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {unattachedSecrets.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => {
                        const id = parseInt(e.target.value, 10);
                        const secret = availableSecrets.find((s) => s.id === id);
                        if (secret) addAttachedSecret(secret.id, secret.name);
                      }}
                      className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-primary text-muted-foreground"
                    >
                      <option value="">＋ Attach secret…</option>
                      {unattachedSecrets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}

                  {attachedSecrets.length > 0 && unattachedSecrets.length === 0 && (
                    <p className="text-xs text-muted-foreground/50 italic">
                      All secrets attached
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Extra files */}
          <div className="p-4 space-y-3">
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
              <p className="text-xs text-muted-foreground/60 italic">No extra files</p>
            ) : (
              <div className="space-y-1">
                {visibleFiles.map(({ originalIndex, filename }) => (
                  <div
                    key={originalIndex}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors",
                      activeTab === originalIndex
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-secondary/40 text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setActiveTab(originalIndex)}
                  >
                    <FileText className="size-3 shrink-0" />
                    <span className="text-xs font-mono flex-1 truncate">
                      {filename || "untitled"}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(originalIndex);
                      }}
                      className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"
                    >
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

    <ConfirmDialog
      open={pendingNav !== null}
      title="Unsaved changes"
      description="You have unsaved changes. Are you sure you want to leave?"
      confirmLabel="Leave"
      destructive
      onConfirm={() => { navigateRef.current(pendingNav!); setPendingNav(null); }}
      onCancel={() => setPendingNav(null)}
    />
    </>
  );
}
