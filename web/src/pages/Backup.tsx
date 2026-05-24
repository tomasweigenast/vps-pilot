import { useState, useRef } from "react";
import { toast } from "sonner";
import { DatabaseBackup, Upload, Download, AlertTriangle, CheckCircle2, Loader2, Terminal, Copy, Check } from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { downloadBackup, restoreBackup } from "@/api/backup";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={copy}
      className="absolute right-2 top-2 rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      title="Copy"
    >
      {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
    </button>
  );
}

const AUTOMATION_SNIPPET = `#!/bin/bash
# Daily backup script — run via cron or systemd timer
# Requires: curl, aws-cli (or rclone)

HOST="https://your-vps-pilot-host"
COOKIE="session=YOUR_SESSION_COOKIE"
DATE=$(date +%Y%m%d-%H%M%S)
FILE="/tmp/vps-pilot-backup-$DATE.zip"

# Download backup
curl -sf -b "$COOKIE" "$HOST/api/backup" -o "$FILE"

# Option A — upload to S3
aws s3 cp "$FILE" s3://your-bucket/backups/

# Option B — upload to Cloudflare R2
# rclone copy "$FILE" r2:your-bucket/vps-pilot/

# Cleanup local file
rm "$FILE"`;

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
          Export a full snapshot of VPS Pilot — database (users, projects, secrets, registries, webhooks, notifications) and all project files on disk.
        </p>
      </div>

      {/* Backup card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-1">Export backup</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Downloads a ZIP file containing a consistent database snapshot and all project files.
          The file can be used to restore this instance or migrate to another server.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => downloadBackup()}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Download className="size-4" />
            Download backup
          </button>
          <span className="text-xs text-muted-foreground font-mono">GET /api/backup</span>
        </div>
      </div>

      {/* Automation card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <Terminal className="size-4 text-muted-foreground/60" />
          <h2 className="text-sm font-semibold">Automate backups</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Call <code className="font-mono bg-secondary px-1 rounded">GET /api/backup</code> from a cron job or systemd timer to schedule automatic backups
          and ship them to external storage (S3, Cloudflare R2, Backblaze B2, etc.).
          Authenticate using a session cookie from a logged-in admin user.
        </p>
        <div className="relative rounded-lg bg-secondary/40 border border-border overflow-hidden">
          <CopyButton text={AUTOMATION_SNIPPET} />
          <pre className="text-[11px] font-mono leading-relaxed p-4 pr-10 overflow-x-auto text-muted-foreground">
            {AUTOMATION_SNIPPET}
          </pre>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          💡 Tip: To get a stable session cookie, create a dedicated <code className="font-mono bg-secondary px-1 rounded">backup-bot</code> local user
          with read-only permissions and use its cookie in the script.
        </p>
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
