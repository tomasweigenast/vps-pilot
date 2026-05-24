import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, Trash2, Pencil, Eye, EyeOff, Loader2, ShieldAlert,
} from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  listSecrets, createSecret, updateSecret, deleteSecret, revealSecret,
} from "@/api/secrets";
import type { Secret } from "@/types";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function SecretFormDialog({
  open,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial?: Secret;
  onClose: () => void;
  onSubmit: (data: { name: string; description: string; value: string }) => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    value: "",
  });
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);

  function field(f: "name" | "description" | "value") {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [f]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) { toast.error("Name is required"); return; }
    if (!initial && !form.value) { toast.error("Value is required"); return; }
    setSaving(true);
    try {
      await onSubmit(form);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{initial ? "Edit Secret" : "New Secret"}</AlertDialogTitle>
          <AlertDialogDescription>
            Values are encrypted at rest with AES-256-GCM. Once injected into a container as an
            environment variable, they are visible to anyone with Docker socket access.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              Name <span className="text-muted-foreground/50">(used as env var key)</span>
            </label>
            <input
              value={form.name}
              onChange={field("name")}
              disabled={!!initial}
              placeholder="DATABASE_URL"
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary disabled:opacity-50"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Description</label>
            <input
              value={form.description}
              onChange={field("description")}
              placeholder="Optional description"
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {initial ? "Value (leave blank to keep existing)" : "Value"}
            </label>
            <div className="relative">
              <input
                type={showValue ? "text" : "password"}
                value={form.value}
                onChange={field("value")}
                placeholder={initial ? "••••••••" : "secret value"}
                className="w-full rounded border border-input bg-background px-3 py-2 pr-9 text-sm font-mono outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => setShowValue((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showValue ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel type="button" onClick={onClose}>Cancel</AlertDialogCancel>
            <AlertDialogAction type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
              {initial ? "Save changes" : "Create secret"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RevealDialog({
  secretId,
  secretName,
  onClose,
}: {
  secretId: number;
  secretName: string;
  onClose: () => void;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showValue, setShowValue] = useState(false);

  async function handleReveal() {
    setLoading(true);
    try {
      const res = await revealSecret(secretId);
      setValue(res.value);
    } catch (e: unknown) {
      toast.error((e as Error).message || "Failed to reveal secret");
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Reveal Secret: {secretName}</AlertDialogTitle>
          <AlertDialogDescription>
            This action is audit-logged. The value is shown once and only visible while this dialog is open.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {value === null ? (
          <div className="py-2">
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to reveal this secret value?
            </p>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleReveal} disabled={loading}>
                {loading ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Eye className="size-3.5 mr-1" />}
                Reveal value
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        ) : (
          <div className="py-2 space-y-3">
            <div className="relative rounded border border-input bg-secondary/30 px-3 py-2 font-mono text-sm break-all">
              <span className={showValue ? "" : "blur-sm select-none"}>{value}</span>
              <button
                type="button"
                onClick={() => setShowValue((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showValue ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
            <AlertDialogFooter>
              <AlertDialogAction onClick={onClose}>Close</AlertDialogAction>
            </AlertDialogFooter>
          </div>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function Secrets() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Secret | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [revealTarget, setRevealTarget] = useState<Secret | null>(null);

  const { data: secrets = [], isLoading } = useQuery({
    queryKey: ["secrets"],
    queryFn: listSecrets,
  });

  const create = useMutation({
    mutationFn: (data: { name: string; description: string; value: string }) =>
      createSecret(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["secrets"] });
      toast.success("Secret created");
    },
    onError: (e: Error) => toast.error(e.message || "Failed to create secret"),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { description: string; value?: string } }) =>
      updateSecret(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["secrets"] });
      toast.success("Secret updated");
    },
    onError: (e: Error) => toast.error(e.message || "Failed to update secret"),
  });

  const del = useMutation({
    mutationFn: (id: number) => deleteSecret(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["secrets"] });
      toast.success("Secret deleted");
      setDeletingId(null);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to delete secret"),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Secrets</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Encrypted key-value pairs injected into projects at deploy time
          </p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setDialogOpen(true); }}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus className="size-3.5" /> New secret
        </button>
      </div>

      {/* Security note */}
      <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 mb-5 text-xs text-yellow-600 dark:text-yellow-400">
        <ShieldAlert className="size-3.5 mt-0.5 shrink-0" />
        <span>
          Values are encrypted in the database (AES-256-GCM). However, when injected into containers
          they appear as environment variables and are visible to anyone with Docker socket access via{" "}
          <code className="font-mono">docker inspect</code>.
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : secrets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 py-16 text-center">
          <p className="text-sm text-muted-foreground">No secrets yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Create secrets to inject sensitive values into your projects at deploy time
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div
            className="grid items-center gap-3 px-4 py-2.5 border-b border-border bg-secondary/10 text-xs text-muted-foreground"
            style={{ gridTemplateColumns: "1.5fr 2fr 1fr 1fr 1fr" }}
          >
            <span>Name</span>
            <span>Description</span>
            <span>Created by</span>
            <span>Updated</span>
            <span className="text-right">Actions</span>
          </div>
          <div className="divide-y divide-border/50">
            {secrets.map((s) => (
              <div
                key={s.id}
                className="grid items-center gap-3 px-4 py-3 text-sm hover:bg-secondary/20 transition-colors"
                style={{ gridTemplateColumns: "1.5fr 2fr 1fr 1fr 1fr" }}
              >
                <span className="font-mono font-medium truncate text-sm">{s.name}</span>
                <span className="text-xs text-muted-foreground truncate">
                  {s.description || <span className="opacity-40 italic">no description</span>}
                </span>
                <span className="text-xs text-muted-foreground truncate">{s.createdBy || "—"}</span>
                <span className="text-xs text-muted-foreground">{formatDate(s.updatedAt)}</span>
                <div className="flex items-center gap-1 justify-end">
                  <button
                    onClick={() => setRevealTarget(s)}
                    title="Reveal value"
                    className="rounded p-1.5 text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
                  >
                    <Eye className="size-3.5" />
                  </button>
                  <button
                    onClick={() => { setEditTarget(s); setDialogOpen(true); }}
                    title="Edit"
                    className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => setDeletingId(s.id)}
                    title="Delete"
                    className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <SecretFormDialog
        open={dialogOpen}
        initial={editTarget ?? undefined}
        onClose={() => setDialogOpen(false)}
        onSubmit={async (data) => {
          if (editTarget) {
            await update.mutateAsync({ id: editTarget.id, data });
          } else {
            await create.mutateAsync(data);
          }
        }}
      />

      <AlertDialog open={deletingId !== null} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete secret?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the secret and remove it from all projects.
              Projects will need to be redeployed for the change to take effect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingId !== null && del.mutate(deletingId)}
              className="bg-destructive text-white hover:opacity-90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {revealTarget && (
        <RevealDialog
          secretId={revealTarget.id}
          secretName={revealTarget.name}
          onClose={() => setRevealTarget(null)}
        />
      )}
    </div>
  );
}
