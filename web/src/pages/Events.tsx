import { useState, useRef, useEffect, useCallback } from "react";
import { Activity, Pause, Play, Trash2, Filter } from "lucide-react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";

interface DockerEvent {
  Type: string;
  Action: string;
  Actor: {
    ID: string;
    Attributes: Record<string, string>;
  };
  scope: string;
  time: number;
  timeNano: number;
}

interface EventEntry extends DockerEvent {
  _seq: number; // internal ordering key
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  container: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  image: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  network: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  volume: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  daemon: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

const ACTION_COLORS: Record<string, string> = {
  start: "text-green-400",
  die: "text-red-400",
  kill: "text-red-500",
  stop: "text-orange-400",
  destroy: "text-red-600",
  create: "text-blue-400",
  pull: "text-purple-400",
  push: "text-purple-400",
  delete: "text-red-400",
  connect: "text-cyan-400",
  disconnect: "text-cyan-400/60",
};

function typeBadge(t: string) {
  return cn(
    "inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium",
    EVENT_TYPE_COLORS[t] ?? "bg-muted text-muted-foreground border-border"
  );
}

function actionColor(a: string) {
  return ACTION_COLORS[a] ?? "text-foreground";
}

function formatTs(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function Events() {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  // Build WS path with optional filters
  const wsPath = (() => {
    const params = new URLSearchParams();
    if (typeFilter) params.set("type", typeFilter);
    if (actionFilter) params.set("action", actionFilter);
    const qs = params.toString();
    return `/api/ws/events${qs ? "?" + qs : ""}`;
  })();

  const onMessage = useCallback((msg: DockerEvent) => {
    if (pausedRef.current) return;
    setEvents((prev) => {
      const next = [...prev, { ...msg, _seq: seqRef.current++ }];
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  const { status } = useWebSocket<DockerEvent>(wsPath, onMessage);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && !paused) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events, autoScroll, paused]);

  const visibleEvents = typeFilter || actionFilter
    ? events.filter((e) => {
        if (typeFilter && e.Type !== typeFilter) return false;
        if (actionFilter && e.Action !== actionFilter) return false;
        return true;
      })
    : events;

  const uniqueTypes = [...new Set(events.map((e) => e.Type))].sort();
  const uniqueActions = [...new Set(events.map((e) => e.Action))].sort();

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Activity className="size-5 text-muted-foreground" />
            Events
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time Docker daemon events
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            "flex items-center gap-1.5 text-xs",
            status === "open" ? "text-green-500" : "text-muted-foreground"
          )}>
            <span className={cn("size-1.5 rounded-full", status === "open" ? "bg-green-500 live-dot" : "bg-muted-foreground")} />
            {status === "open" ? "Connected" : status}
          </span>
          <button
            onClick={() => setPaused((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              paused
                ? "border-amber-500/50 bg-amber-500/10 text-amber-500"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
            )}
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={() => setEvents([])}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Trash2 className="size-3.5" /> Clear
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 shrink-0">
        <Filter className="size-3.5 text-muted-foreground" />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
        >
          <option value="">All types</option>
          {uniqueTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
        >
          <option value="">All actions</option>
          {uniqueActions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">
          {visibleEvents.length} event{visibleEvents.length !== 1 ? "s" : ""}
        </span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="rounded"
          />
          Auto-scroll
        </label>
      </div>

      {/* Event table */}
      <div className="flex-1 min-h-0 rounded-xl border border-border bg-card overflow-hidden flex flex-col">
        <div
          className="grid gap-3 px-4 py-2.5 border-b border-border bg-secondary/10 text-[10px] font-medium text-muted-foreground uppercase tracking-wider shrink-0"
          style={{ gridTemplateColumns: "80px 90px 120px 1fr 160px" }}
        >
          <span>Time</span>
          <span>Type</span>
          <span>Action</span>
          <span>Object</span>
          <span>Attributes</span>
        </div>

        {visibleEvents.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
            {status === "open"
              ? paused
                ? "Stream paused — resume to see new events"
                : "Waiting for events…"
              : "Connecting to Docker daemon…"}
          </div>
        ) : (
          <div className="overflow-y-auto flex-1">
            {visibleEvents.map((e) => {
              const objName = e.Actor?.Attributes?.name ?? e.Actor?.ID?.slice(0, 12) ?? "—";
              const attrs = Object.entries(e.Actor?.Attributes ?? {})
                .filter(([k]) => k !== "name" && !k.startsWith("com.docker."))
                .slice(0, 4)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ");
              return (
                <div
                  key={e._seq}
                  className="grid gap-3 px-4 py-2 text-xs border-b border-border/30 last:border-0 hover:bg-secondary/20 transition-colors"
                  style={{ gridTemplateColumns: "80px 90px 120px 1fr 160px" }}
                >
                  <span className="font-mono text-muted-foreground text-[11px]">
                    {formatTs(e.time)}
                  </span>
                  <span>
                    <span className={typeBadge(e.Type)}>{e.Type}</span>
                  </span>
                  <span className={cn("font-medium", actionColor(e.Action))}>
                    {e.Action}
                  </span>
                  <span className="font-mono truncate" title={objName}>{objName}</span>
                  <span className="font-mono text-[10px] text-muted-foreground truncate" title={attrs}>
                    {attrs || "—"}
                  </span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
