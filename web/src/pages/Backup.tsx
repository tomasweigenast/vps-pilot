import { useState, useRef } from "react";
import { toast } from "sonner";
import { DatabaseBackup, Upload, Download, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { downloadBackup, restoreBackup } from "@/api/backup";

export function Backup() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{ createdAt: string; note: string } | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setSelectedFile(f);
    setRestoreResult(null);
  }

  async function doRestore() {
    if (!selectedFile) return;
    setRestoring(true);
    setConfirmRestore(false);
    try {
      const result = await restoreBackup(selectedFile);
      setRestoreResult({ createdAt: result.createdAt, note: result.note });
      toast.success("Database restored successfully");
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e: unknown) {
      toast.error((e as Error).message || "Restore failed");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <DatabaseBackup className="size-5 text-muted-foreground" />
          Backup & Restore
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Export a snapshot of the VPS Manager database (users, projects, secrets, registries, webhooks, notifications).
          Compose files and container data are not included.
        </p>
      </div>

      {/* Backup card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-1">Export backup</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Downloads a ZIP file containing a consistent snapshot of the database.
          The file can be used to restore this instance or migrate to another server.
        </p>
        <button
          onClick={() => downloadBackup()}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Download className="size-4" />
          Download backup
        </button>
      </div>

      {/* Restore card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-1">Restore from backup</h2>
        <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2.5 mb-4">
          <AlertTriangle className="size-4 text-yellow-500 mt-0.5 shrink-0" />
          <p className="text-xs text-yellow-600 dark:text-yellow-400">
            <strong>Warning:</strong> Restoring will overwrite all current data. This action cannot be undone.
            The server will need to be restarted after restore for changes to take full effect.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1.5">Select backup file (.zip)</label>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".zip"
                onChange={handleFileChange}
                className="block text-xs text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-border file:text-xs file:font-medium file:bg-secondary file:text-foreground hover:file:bg-secondary/80 file:cursor-pointer cursor-pointer"
              />
            </div>
          </div>

          {selectedFile && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{selectedFile.name}</span>
              <span>({(selectedFile.size / 1024).toFixed(1)} KB)</span>
            </div>
          )}

          <button
            onClick={() => setConfirmRestore(true)}
            disabled={!selectedFile || restoring}
            className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/20 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            {restoring ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Restore backup
          </button>
        </div>

        {restoreResult && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2.5">
            <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-green-600 dark:text-green-400">Restore successful</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Backup from {new Date(restoreResult.createdAt).toLocaleString()} applied.
              </p>
              <p className="text-xs text-muted-foreground">{restoreResult.note}</p>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={confirmRestore} onOpenChange={(o) => !o && setConfirmRestore(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore database?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace all current data with the contents of{" "}
              <strong>{selectedFile?.name}</strong>. This cannot be undone.
              Make sure you have a fresh backup before proceeding.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doRestore}
              className="bg-destructive text-white hover:opacity-90"
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
