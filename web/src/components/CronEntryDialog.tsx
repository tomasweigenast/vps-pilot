import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Clock, ChevronDown, Loader2, Info } from "lucide-react";
import { validateCronExpression, type CronEntry } from "@/api/cron";
import { cn } from "@/lib/utils";

// ── helpers ──────────────────────────────────────────────────────────────────

const PRESETS: { label: string; value: string }[] = [
  { label: "Every minute",           value: "* * * * *" },
  { label: "Every hour",             value: "0 * * * *" },
  { label: "Daily at midnight",      value: "0 0 * * *" },
  { label: "Daily at noon",          value: "0 12 * * *" },
  { label: "Every week (Sun)",       value: "0 0 * * 0" },
  { label: "Every month (1st)",      value: "0 0 1 * *" },
  { label: "Yearly (Jan 1)",         value: "0 0 1 1 *" },
  { label: "On reboot",              value: "@reboot" },
  { label: "Custom…",               value: "custom" },
];

const FIELD_HINT: Record<string, string> = {
  minute:  "0–59, *, */5, 0-30",
  hour:    "0–23, *, */2, 8-17",
  day:     "1–31, *, */2, 1,15",
  month:   "1–12, *, jan-dec",
  weekday: "0–7 (0/7=Sun), *, mon-sun",
};

const MONTH_NAMES  = ["*","1","2","3","4","5","6","7","8","9","10","11","12"];
const DOW_NAMES    = ["*","0","1","2","3","4","5","6"];

function formatRFC3339Local(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

// ── InlineFieldPicker ─────────────────────────────────────────────────────────

function InlineFieldPicker({
  field, value, onChange,
}: {
  field: "minute" | "hour" | "day" | "month" | "weekday";
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setDraft(value); }, [value]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const options = field === "month" ? MONTH_NAMES : field === "weekday" ? DOW_NAMES : null;
  const fieldLabels: Record<string, string> = {
    minute: "Min", hour: "Hour", day: "Day", month: "Month", weekday: "Wday",
  };

  return (
    <div className="relative flex flex-col gap-1" ref={ref}>
      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        {fieldLabels[field]}
      </label>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between rounded-md border border-input bg-background px-2.5 py-1 text-sm font-mono min-w-[60px] hover:bg-accent transition-colors"
      >
        {value}
        <ChevronDown className="size-3 ml-1 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-56 rounded-lg border border-border bg-popover shadow-lg p-3 space-y-2.5">
          <p className="text-[10px] text-muted-foreground">{FIELD_HINT[field]}</p>

          {options && (
            <div className="flex flex-wrap gap-1">
              {options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => { onChange(opt); setOpen(false); }}
                  className={cn(
                    "text-[11px] font-mono px-1.5 py-0.5 rounded border transition-colors",
                    value === opt
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-input hover:bg-accent"
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-1.5">
            <input
              className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. */5"
              onKeyDown={(e) => {
                if (e.key === "Enter") { onChange(draft); setOpen(false); }
              }}
            />
            <button
              type="button"
              onClick={() => { onChange(draft); setOpen(false); }}
              className="px-2 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:opacity-90"
            >
              Set
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CronEntryDialog ───────────────────────────────────────────────────────────

export interface CronEntryDialogProps {
  open: boolean;
  initial?: CronEntry;
  user: string;
  onClose: () => void;
  onSave: (entry: CronEntry) => void;
}

const BLANK_JOB: CronEntry = {
  id: "",
  type: "job",
  disabled: false,
  special: "",
  minute: "*",
  hour: "*",
  day: "*",
  month: "*",
  weekday: "*",
  command: "",
  comment: "",
};

export function CronEntryDialog({ open, initial, onClose, onSave }: CronEntryDialogProps) {
  const [entry, setEntry] = useState<CronEntry>(initial ?? BLANK_JOB);
  const [schedMode, setSchedMode] = useState<"preset" | "custom">("preset");
  const [preset, setPreset] = useState("* * * * *");
  const [nextRuns, setNextRuns] = useState<string[]>([]);
  const [validateErr, setValidateErr] = useState("");
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset form when dialog opens.
  useEffect(() => {
    if (open) {
      const e = initial ?? BLANK_JOB;
      setEntry(e);
      setValidateErr("");
      setNextRuns([]);
      const sched = e.special || `${e.minute} ${e.hour} ${e.day} ${e.month} ${e.weekday}`;
      const matched = PRESETS.find(p => p.value !== "custom" && p.value === sched);
      if (matched) {
        setPreset(matched.value);
        setSchedMode("preset");
      } else {
        setSchedMode("custom");
        setPreset("custom");
      }
    }
  }, [open, initial]);

  const currentExpr = (): string => {
    if (entry.special) return entry.special;
    return `${entry.minute} ${entry.hour} ${entry.day} ${entry.month} ${entry.weekday}`;
  };

  const doValidate = useCallback(async (expr: string) => {
    if (!expr || expr === "@reboot") {
      setNextRuns([]);
      setValidateErr("");
      return;
    }
    setValidating(true);
    try {
      const res = await validateCronExpression(expr, 5);
      setNextRuns(res.nextRuns);
      setValidateErr("");
    } catch (err: unknown) {
      setNextRuns([]);
      setValidateErr(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  }, []);

  // Auto-validate on schedule change (debounced).
  useEffect(() => {
    const expr = currentExpr();
    const t = setTimeout(() => doValidate(expr), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.special, entry.minute, entry.hour, entry.day, entry.month, entry.weekday]);

  function applyPreset(value: string) {
    setPreset(value);
    if (value === "custom") {
      setSchedMode("custom");
      return;
    }
    setSchedMode("preset");
    if (value.startsWith("@")) {
      setEntry(e => ({ ...e, special: value, minute: "*", hour: "*", day: "*", month: "*", weekday: "*" }));
    } else {
      const parts = value.split(" ");
      setEntry(e => ({
        ...e, special: "",
        minute: parts[0], hour: parts[1], day: parts[2], month: parts[3], weekday: parts[4],
      }));
    }
  }

  function setField<K extends keyof CronEntry>(key: K, val: CronEntry[K]) {
    setEntry(e => ({ ...e, [key]: val }));
  }

  async function handleSave(ev: React.FormEvent) {
    ev.preventDefault();
    if (!entry.command?.trim()) return;
    setSaving(true);
    try {
      onSave(entry);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-4" />
            {initial ? "Edit cron job" : "New cron job"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Schedule presets */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Schedule</label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => applyPreset(p.value)}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full border transition-colors",
                    (preset === p.value)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-input hover:bg-accent"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom fields */}
            {schedMode === "custom" && !entry.special && (
              <div className="flex flex-wrap gap-3 pt-1">
                {(["minute", "hour", "day", "month", "weekday"] as const).map(f => (
                  <InlineFieldPicker
                    key={f}
                    field={f}
                    value={(entry[f] as string) ?? "*"}
                    onChange={(v) => { setField(f, v); }}
                  />
                ))}
              </div>
            )}

            {/* Expression preview */}
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5">
              <code className="text-sm font-mono flex-1">{currentExpr()}</code>
              {validating && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
            </div>

            {validateErr && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <Info className="size-3" /> {validateErr}
              </p>
            )}
            {!validateErr && nextRuns.length > 0 && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Next {nextRuns.length} runs
                </p>
                {nextRuns.map((r) => (
                  <p key={r} className="text-xs font-mono text-foreground">{formatRFC3339Local(r)}</p>
                ))}
              </div>
            )}
          </div>

          {/* Command */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Command</label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono"
              value={entry.command ?? ""}
              onChange={(e) => setField("command", e.target.value)}
              placeholder="/usr/local/bin/my-script.sh"
              required
            />
          </div>

          {/* Comment */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground">Comment (optional)</label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              value={entry.comment ?? ""}
              onChange={(e) => setField("comment", e.target.value)}
              placeholder="What does this job do?"
            />
          </div>

          {/* Disabled toggle */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={!entry.disabled}
              onClick={() => setField("disabled", !entry.disabled)}
              className={cn(
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                entry.disabled ? "bg-muted-foreground/30" : "bg-primary"
              )}
            >
              <span
                className={cn(
                  "inline-block size-4 rounded-full bg-white shadow transition-transform",
                  entry.disabled ? "translate-x-0.5" : "translate-x-[18px]"
                )}
              />
            </button>
            <span className="text-sm">{entry.disabled ? "Disabled" : "Enabled"}</span>
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !entry.command?.trim()}
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving && <Loader2 className="size-3 animate-spin" />}
              Save
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
