import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Clock, Plus, Pencil, Trash2, Code, LayoutList,
  Save, Loader2, ChevronDown, Power, PowerOff,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { oneDark } from "@codemirror/theme-one-dark";
import { cn } from "@/lib/utils";
import {
  listCronUsers, getCrontab, saveCrontabRaw, saveCrontabEntries,
  type CronEntry,
} from "@/api/cron";
import { CronEntryDialog } from "@/components/CronEntryDialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

// ── helpers ──────────────────────────────────────────────────────────────────

function scheduleLabel(entry: CronEntry): string {
  if (entry.special) return entry.special;
  return `${entry.minute} ${entry.hour} ${entry.day} ${entry.month} ${entry.weekday}`;
}

function formatNextRun(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  });
}

// ── CronJobRow ────────────────────────────────────────────────────────────────

function CronJobRow({
  entry,
  onEdit,
  onDelete,
  onToggle,
}: {
  entry: CronEntry;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors",
        entry.disabled
          ? "bg-muted/40 border-border opacity-60"
          : "bg-card border-border hover:bg-accent/20"
      )}
    >
      {/* Toggle */}
      <button
        type="button"
        onClick={onToggle}
        title={entry.disabled ? "Enable" : "Disable"}
        className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
      >
        {entry.disabled
          ? <PowerOff className="size-4 text-muted-foreground" />
          : <Power className="size-4 text-green-500" />
        }
      </button>

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">
            {scheduleLabel(entry)}
          </code>
          {entry.nextRun && !entry.disabled && (
            <span className="text-[10px] text-muted-foreground">
              next: {formatNextRun(entry.nextRun)}
            </span>
          )}
        </div>
        <p className="text-sm font-mono truncate text-foreground/90" title={entry.command}>
          {entry.command}
        </p>
        {entry.comment && (
          <p className="text-[11px] text-muted-foreground">{entry.comment}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onEdit}
          className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          title="Edit"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
          title="Delete"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── CronJobs page ─────────────────────────────────────────────────────────────

export function CronJobs() {
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [viewMode, setViewMode] = useState<"visual" | "raw">("visual");
  const [rawContent, setRawContent] = useState("");
  const [entries, setEntries] = useState<CronEntry[]>([]);
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CronEntry | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<CronEntry | undefined>();
  const [dirty, setDirty] = useState(false);

  // Load users.
  const { data: users = [] } = useQuery({
    queryKey: ["cron-users"],
    queryFn: listCronUsers,
  });

  useEffect(() => {
    if (users.length > 0 && !selectedUser) {
      setSelectedUser(users.includes("root") ? "root" : users[0]);
    }
  }, [users, selectedUser]);

  // Load crontab for selected user.
  const { data: crontab, isLoading } = useQuery({
    queryKey: ["crontab", selectedUser],
    queryFn: () => getCrontab(selectedUser),
    enabled: !!selectedUser,
  });

  useEffect(() => {
    if (crontab) {
      setRawContent(crontab.raw);
      setEntries(crontab.entries);
      setDirty(false);
    }
  }, [crontab]);

  // Save mutations.
  const saveRawMut = useMutation({
    mutationFn: () => saveCrontabRaw(selectedUser, rawContent),
    onSuccess: () => { toast.success("Crontab saved"); setDirty(false); },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveEntriesMut = useMutation({
    mutationFn: () => saveCrontabEntries(selectedUser, entries),
    onSuccess: () => { toast.success("Crontab saved"); setDirty(false); },
    onError: (err: Error) => toast.error(err.message),
  });

  const isSaving = saveRawMut.isPending || saveEntriesMut.isPending;

  function handleSave() {
    if (viewMode === "raw") {
      saveRawMut.mutate();
    } else {
      saveEntriesMut.mutate();
    }
  }

  // Visual editor helpers.
  function jobEntries(): CronEntry[] {
    return entries.filter(e => e.type === "job");
  }

  function handleEntryDialogSave(updated: CronEntry) {
    if (editingEntry) {
      setEntries(prev => prev.map(e => e.id === editingEntry.id ? { ...updated, id: editingEntry.id } : e));
    } else {
      // New entry: generate a temporary id and append before the last blank/comment.
      const newEntry: CronEntry = {
        ...updated,
        id: `new-${Date.now()}`,
        type: "job",
      };
      setEntries(prev => [...prev, newEntry]);
    }
    setDirty(true);
    setEntryDialogOpen(false);
  }

  function handleToggle(id: string) {
    setEntries(prev =>
      prev.map(e => e.id === id ? { ...e, disabled: !e.disabled } : e)
    );
    setDirty(true);
  }

  function handleDelete(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id));
    setDirty(true);
    setDeleteTarget(undefined);
  }

  const jobs = jobEntries();

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Clock className="size-5 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">Cron Jobs</h1>
            <p className="text-sm text-muted-foreground">Manage system crontabs</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* User selector */}
          {users.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent transition-colors">
                <span className="font-mono">{selectedUser || "—"}</span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {users.map(u => (
                  <DropdownMenuItem
                    key={u}
                    onClick={() => { setSelectedUser(u); setDirty(false); }}
                    className={u === selectedUser ? "font-medium" : ""}
                  >
                    {u}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* View toggle */}
          <div className="flex rounded-md border border-input overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("visual")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors",
                viewMode === "visual" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"
              )}
            >
              <LayoutList className="size-3.5" />
              Visual
            </button>
            <button
              type="button"
              onClick={() => setViewMode("raw")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors",
                viewMode === "raw" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"
              )}
            >
              <Code className="size-3.5" />
              Raw
            </button>
          </div>

          {/* Save */}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !dirty}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading crontab…
        </div>
      )}

      {!isLoading && selectedUser && (
        <>
          {viewMode === "visual" && (
            <div className="space-y-3">
              {jobs.length === 0 && (
                <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                  No cron jobs for <span className="font-mono">{selectedUser}</span>. Add one below.
                </div>
              )}

              {jobs.map(entry => (
                <CronJobRow
                  key={entry.id}
                  entry={entry}
                  onEdit={() => { setEditingEntry(entry); setEntryDialogOpen(true); }}
                  onDelete={() => setDeleteTarget(entry)}
                  onToggle={() => handleToggle(entry.id)}
                />
              ))}

              <button
                type="button"
                onClick={() => { setEditingEntry(undefined); setEntryDialogOpen(true); }}
                className="flex items-center gap-2 w-full rounded-lg border border-dashed border-border py-3 px-4 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors"
              >
                <Plus className="size-4" /> Add cron job
              </button>
            </div>
          )}

          {viewMode === "raw" && (
            <div className="rounded-lg overflow-hidden border border-border">
              <div className="bg-muted px-4 py-2 text-xs text-muted-foreground font-mono border-b border-border">
                crontab for {selectedUser}
              </div>
              <CodeMirror
                value={rawContent}
                theme={oneDark}
                extensions={[StreamLanguage.define(shell)]}
                onChange={(val) => { setRawContent(val); setDirty(true); }}
                minHeight="300px"
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: false,
                  autocompletion: false,
                }}
              />
            </div>
          )}
        </>
      )}

      {/* Entry dialog */}
      <CronEntryDialog
        open={entryDialogOpen}
        initial={editingEntry}
        user={selectedUser}
        onClose={() => setEntryDialogOpen(false)}
        onSave={handleEntryDialogSave}
      />

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete cron job?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the job{" "}
              <code className="font-mono text-foreground">{deleteTarget?.command}</code>{" "}
              from the crontab. You must save to apply the change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
