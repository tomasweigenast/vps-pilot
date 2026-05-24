import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bell, Plus, Trash2, TestTube2, Loader2, Pencil,
  ChevronDown, ChevronRight, Mail, Webhook, MessageSquare,
  ToggleLeft, ToggleRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  listChannels, createChannel, updateChannel, deleteChannel, testChannel,
  createRule, deleteRule,
  EVENT_TYPES,
  type NotificationChannel, type ChannelForm, type RuleForm,
} from "@/api/notifications";

// ─── Channel type icon ────────────────────────────────────────────────────────

function ChannelTypeIcon({ type }: { type: string }) {
  switch (type) {
    case "email": return <Mail className="size-4 text-blue-400" />;
    case "slack": return <Webhook className="size-4 text-yellow-400" />;
    case "discord": return <MessageSquare className="size-4 text-purple-400" />;
    default: return <Webhook className="size-4 text-green-400" />;
  }
}

// ─── Config templates per type ────────────────────────────────────────────────

function defaultConfig(type: string): string {
  switch (type) {
    case "email":
      return JSON.stringify({
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        username: "",
        password: "",
        from: "alerts@example.com",
        to: "admin@example.com",
      }, null, 2);
    case "slack":
      return JSON.stringify({ webhookUrl: "https://hooks.slack.com/services/..." }, null, 2);
    case "discord":
      return JSON.stringify({ webhookUrl: "https://discord.com/api/webhooks/..." }, null, 2);
    default:
      return JSON.stringify({ url: "https://example.com/webhook", headers: {} }, null, 2);
  }
}

// ─── Channel Form Dialog ──────────────────────────────────────────────────────

function ChannelDialog({
  open, initial, onClose, onSubmit,
}: {
  open: boolean;
  initial?: NotificationChannel;
  onClose: () => void;
  onSubmit: (data: ChannelForm) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<string>(initial?.type ?? "webhook");
  const [config, setConfig] = useState(initial?.config ?? defaultConfig("webhook"));
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [saving, setSaving] = useState(false);

  function handleTypeChange(t: string) {
    setType(t);
    if (!initial) setConfig(defaultConfig(t));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !type) { toast.error("Name and type are required"); return; }
    setSaving(true);
    try {
      await onSubmit({ name, type, config, enabled });
      onClose();
    } finally { setSaving(false); }
  }

  if (!open) return null;

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{initial ? "Edit Channel" : "Add Channel"}</AlertDialogTitle>
          <AlertDialogDescription>
            Configure where notifications should be sent.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Slack channel"
                className="w-full rounded border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Type</label>
              <select
                value={type}
                onChange={(e) => handleTypeChange(e.target.value)}
                className="w-full rounded border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="webhook">Webhook (generic)</option>
                <option value="slack">Slack</option>
                <option value="discord">Discord</option>
                <option value="email">Email (SMTP)</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Configuration (JSON)</label>
            <textarea
              value={config}
              onChange={(e) => setConfig(e.target.value)}
              rows={6}
              className="w-full rounded border border-input bg-background px-3 py-2 text-xs font-mono outline-none focus:border-primary resize-y"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span className="text-sm">Enabled</span>
          </label>

          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel type="button" onClick={onClose}>Cancel</AlertDialogCancel>
            <AlertDialogAction type="submit" disabled={saving}>
              {saving && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
              {initial ? "Save changes" : "Add channel"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Add Rule Dialog ──────────────────────────────────────────────────────────

function AddRuleDialog({
  channelId, onClose,
}: { channelId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [eventType, setEventType] = useState(EVENT_TYPES[0].value);
  const [projectFilter, setProjectFilter] = useState("");
  const [saving, setSaving] = useState(false);

  const add = useMutation({
    mutationFn: (data: RuleForm) => createRule(channelId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Rule added");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to add rule"),
  });

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Add notification rule</AlertDialogTitle>
          <AlertDialogDescription>
            Trigger this channel when a specific event occurs.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 mt-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Event type</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {EVENT_TYPES.map((et) => (
                <option key={et.value} value={et.value}>{et.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              Project filter <span className="text-muted-foreground/60">(leave empty for all projects)</span>
            </label>
            <input
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              placeholder="myapp, otherapp"
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>
        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={() => {
              setSaving(true);
              add.mutate({
                eventType,
                projectFilter: projectFilter.trim() || null,
                enabled: true,
              });
            }}
          >
            {saving && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
            Add rule
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Channel Card ─────────────────────────────────────────────────────────────

function ChannelCard({
  channel, onEdit, onDelete,
}: { channel: NotificationChannel; onEdit: () => void; onDelete: () => void }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [addingRule, setAddingRule] = useState(false);
  const [testing, setTesting] = useState(false);

  const delRule = useMutation({
    mutationFn: (id: number) => deleteRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
    onError: (e: Error) => toast.error(e.message || "Failed to delete rule"),
  });

  async function handleTest() {
    setTesting(true);
    try {
      await testChannel(channel.id);
      toast.success("Test notification sent!");
    } catch (e: unknown) {
      toast.error((e as Error).message || "Test failed");
    } finally {
      setTesting(false);
    }
  }

  const eventLabel = (type: string) => EVENT_TYPES.find((et) => et.value === type)?.label ?? type;

  return (
    <>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
          <ChannelTypeIcon type={channel.type} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{channel.name}</span>
              <span className="text-xs rounded-full bg-secondary px-2 py-0.5 text-muted-foreground capitalize">{channel.type}</span>
              {!channel.enabled && (
                <span className="text-xs rounded-full bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 text-yellow-500">Disabled</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {channel.rules.length} rule{channel.rules.length !== 1 ? "s" : ""}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleTest}
              disabled={testing}
              title="Send test notification"
              className="rounded p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-40 transition-colors"
            >
              {testing ? <Loader2 className="size-3.5 animate-spin" /> : <TestTube2 className="size-3.5" />}
            </button>
            <button onClick={onEdit} title="Edit" className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              <Pencil className="size-3.5" />
            </button>
            <button onClick={onDelete} title="Delete" className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Rules */}
        {expanded && (
          <div className="border-t border-border bg-secondary/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Rules</span>
              <button
                onClick={() => setAddingRule(true)}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Plus className="size-3" /> Add rule
              </button>
            </div>
            {channel.rules.length === 0 ? (
              <p className="text-xs text-muted-foreground">No rules — this channel won't receive any notifications.</p>
            ) : (
              <div className="space-y-1.5">
                {channel.rules.map((rule) => (
                  <div key={rule.id} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                    <button
                      title={rule.enabled ? "Enabled" : "Disabled"}
                      className={cn(
                        "text-muted-foreground transition-colors",
                        rule.enabled ? "text-green-400" : "text-zinc-500"
                      )}
                    >
                      {rule.enabled ? <ToggleRight className="size-4" /> : <ToggleLeft className="size-4" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">{eventLabel(rule.eventType)}</span>
                      {rule.projectFilter && (
                        <span className="text-xs text-muted-foreground ml-2">→ {rule.projectFilter}</span>
                      )}
                    </div>
                    <button
                      onClick={() => delRule.mutate(rule.id)}
                      disabled={delRule.isPending}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {addingRule && <AddRuleDialog channelId={channel.id} onClose={() => setAddingRule(false)} />}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function Notifications() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<NotificationChannel | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const { data: channels = [], isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: listChannels,
  });

  const create = useMutation({
    mutationFn: (data: ChannelForm) => createChannel(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notifications"] }); toast.success("Channel created"); },
    onError: (e: Error) => toast.error(e.message || "Failed to create channel"),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ChannelForm }) => updateChannel(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notifications"] }); toast.success("Channel updated"); },
    onError: (e: Error) => toast.error(e.message || "Failed to update channel"),
  });

  const del = useMutation({
    mutationFn: (id: number) => deleteChannel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Channel deleted");
      setDeletingId(null);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to delete channel"),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Bell className="size-5 text-muted-foreground" />
            Notifications
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure channels and rules to receive alerts for container and deploy events
          </p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setDialogOpen(true); }}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus className="size-3.5" /> Add channel
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : channels.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 py-16 text-center">
          <Bell className="size-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No notification channels configured</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Add a channel (Slack, Discord, webhook, email) and attach rules to receive alerts
          </p>
          <button
            onClick={() => setDialogOpen(true)}
            className="mt-4 flex items-center gap-1 text-xs text-primary hover:underline mx-auto"
          >
            <Plus className="size-3" /> Add first channel
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {channels.map((ch) => (
            <ChannelCard
              key={ch.id}
              channel={ch}
              onEdit={() => { setEditTarget(ch); setDialogOpen(true); }}
              onDelete={() => setDeletingId(ch.id)}
            />
          ))}
        </div>
      )}

      <ChannelDialog
        open={dialogOpen}
        initial={editTarget ?? undefined}
        onClose={() => { setDialogOpen(false); setEditTarget(null); }}
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
            <AlertDialogTitle>Delete channel?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the channel and all its rules. This action cannot be undone.
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
    </div>
  );
}
