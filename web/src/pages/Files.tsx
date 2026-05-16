import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listFiles, getFileContent, updateFile, deleteFile } from "@/api/files";
import { Folder, File, Download, ChevronRight, Home, Pencil, Trash2, Save, X, Loader2 } from "lucide-react";
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

function bytes(n: number) {
  if (!n) return "—";
  const k = 1024, u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / k ** i).toFixed(1)} ${u[i]}`;
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

interface EditorState {
  path: string;
  name: string;
  originalContent: string;
  content: string;
}

export function Files() {
  const [path, setPath] = useState("/");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; name: string; isDir: boolean } | null>(null);

  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["files", path],
    queryFn: () => listFiles(path),
  });

  const breadcrumbs = path.split("/").filter(Boolean);

  const openEditor = useCallback(async (filePath: string, name: string) => {
    setLoadingEdit(filePath);
    try {
      const result = await getFileContent(filePath);
      setEditor({ path: filePath, name, originalContent: result.content, content: result.content });
    } catch (e) {
      toast.error((e as Error).message || "Could not read file");
    } finally {
      setLoadingEdit(null);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!editor) return;
    setSaving(true);
    try {
      await updateFile(editor.path, editor.content);
      toast.success("File saved");
      setEditor((e) => e ? { ...e, originalContent: e.content } : null);
    } catch (e) {
      toast.error((e as Error).message || "Failed to save file");
    } finally {
      setSaving(false);
    }
  }, [editor]);

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    setDeleting(deleteConfirm.path);
    setDeleteConfirm(null);
    try {
      await deleteFile(deleteConfirm.path);
      toast.success(`Deleted ${deleteConfirm.name}`);
      qc.invalidateQueries({ queryKey: ["files", path] });
      if (editor?.path === deleteConfirm.path) setEditor(null);
    } catch (e) {
      toast.error((e as Error).message || `Failed to delete "${deleteConfirm?.name}"`);
    } finally {
      setDeleting(null);
    }
  }, [deleteConfirm, path, qc, editor]);

  const isDirty = editor ? editor.content !== editor.originalContent : false;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Files</h1>
        <p className="text-sm text-muted-foreground">Browse, edit, and manage server files</p>
      </div>

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <button onClick={() => setPath("/")} className="hover:text-foreground transition-colors">
          <Home className="size-3.5" />
        </button>
        {breadcrumbs.map((part, i) => {
          const to = "/" + breadcrumbs.slice(0, i + 1).join("/");
          return (
            <span key={to} className="flex items-center gap-1">
              <ChevronRight className="size-3" />
              <button onClick={() => setPath(to)} className="hover:text-foreground transition-colors">
                {part}
              </button>
            </span>
          );
        })}
      </nav>

      <div className={`flex gap-4 ${editor ? "items-start" : ""}`}>
        {/* File listing */}
        <div className="rounded-xl border border-border bg-card overflow-hidden flex-1 min-w-0">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-xs font-mono text-muted-foreground">{path}</h2>
          </div>

          {isLoading ? (
            <div className="p-5 space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-7 rounded bg-secondary animate-pulse" />
              ))}
            </div>
          ) : !data?.length ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Empty directory
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data.map((entry) => (
                <div key={entry.path} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-secondary/30 transition-colors">
                  {entry.isDir
                    ? <Folder className="size-4 text-primary/60 shrink-0" />
                    : <File className="size-4 text-muted-foreground/40 shrink-0" />}

                  {entry.isDir ? (
                    <button className="flex-1 text-left hover:text-primary transition-colors" onClick={() => setPath(entry.path)}>
                      {entry.name}
                    </button>
                  ) : (
                    <span className="flex-1 text-muted-foreground truncate">{entry.name}</span>
                  )}

                  <span className="text-xs font-mono text-muted-foreground/50 shrink-0">{bytes(entry.size)}</span>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {!entry.isDir && (
                      <>
                        <a
                          href={`/files/download?path=${encodeURIComponent(entry.path)}`}
                          download
                          className="text-muted-foreground hover:text-primary transition-colors"
                          title="Download"
                        >
                          <Download className="size-3.5" />
                        </a>
                        <button
                          onClick={() => openEditor(entry.path, entry.name)}
                          disabled={loadingEdit === entry.path}
                          className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                          title="Edit"
                        >
                          {loadingEdit === entry.path
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <Pencil className="size-3.5" />}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setDeleteConfirm({ path: entry.path, name: entry.name, isDir: entry.isDir })}
                      disabled={deleting === entry.path}
                      className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                      title="Delete"
                    >
                      {deleting === entry.path
                        ? <Loader2 className="size-3.5 animate-spin" />
                        : <Trash2 className="size-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Editor panel */}
        {editor && (
          <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col w-[55%] shrink-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5 gap-3">
              <span className="text-xs font-mono text-muted-foreground truncate">{editor.path}</span>
              <div className="flex items-center gap-2 shrink-0">
                {isDirty && <span className="text-xs text-amber-500">Unsaved</span>}
                <button
                  onClick={handleSave}
                  disabled={saving || !isDirty}
                  className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-2.5 py-1 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Save
                </button>
                <button
                  onClick={() => setEditor(null)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Close"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <div className="overflow-auto max-h-[70vh]">
              <CodeMirror
                value={editor.content}
                onChange={(val) => setEditor((e) => e ? { ...e, content: val } : null)}
                extensions={getLanguageExtension(editor.name)}
                theme={oneDark}
                basicSetup={{ lineNumbers: true, foldGutter: true }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-sm space-y-4 shadow-xl">
            <h3 className="font-semibold text-base">Delete {deleteConfirm.isDir ? "directory" : "file"}?</h3>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono text-foreground">{deleteConfirm.name}</span>
              {deleteConfirm.isDir && " and all its contents"} will be permanently deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
