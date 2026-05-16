import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Trash2, Pause, Play, Search } from "lucide-react";
import type { WSMessage } from "@/types";

const ALL_LEVELS = ["error", "warn", "info", "debug"];

// ─── Server logs tab ─────────────────────────────────────────────────────────

function ServerLogs() {
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const bottomRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useWebSocket<WSMessage<string>>("/api/ws/logs", (msg) => {
    if (msg.type === "log" && !pausedRef.current) {
      setLines((p) => [...p.slice(-2000), msg.data]);
    }
  });

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, paused]);

  const filtered = useMemo(() =>
    lines.filter((line) => {
      const lo = line.toLowerCase();
      if (search && !lo.includes(search.toLowerCase())) return false;
      if (levelFilter !== "all" && !lo.includes(`level=${levelFilter}`)) return false;
      return true;
    }),
  [lines, search, levelFilter]);

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/60" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter…"
            className="rounded border border-input bg-background pl-7 pr-3 py-1.5 text-xs outline-none focus:border-primary w-40"
          />
        </div>
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="rounded border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
        >
          <option value="all">All levels</option>
          {ALL_LEVELS.map((l) => (
            <option key={l} value={l}>{l.toUpperCase()}</option>
          ))}
        </select>
        <button
          onClick={() => setPaused((p) => !p)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={() => setLines([])}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Trash2 className="size-3" /> Clear
        </button>
        <span className="ml-auto text-xs text-muted-foreground/50">{filtered.length} lines</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs bg-slate-950 text-slate-300 rounded-xl border border-border">
        {filtered.length === 0 ? (
          <span className="text-muted-foreground/50">
            {paused ? "Stream paused — resume to see new events." : "Waiting for events…"}
          </span>
        ) : (
          filtered.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all text-green-400/70 leading-5">{line}</div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ─── Journalctl tab ──────────────────────────────────────────────────────────

const JOURNAL_PRIORITIES = [
  { label: "All", value: "" },
  { label: "ERROR", value: "3" },
  { label: "WARNING", value: "4" },
  { label: "NOTICE", value: "5" },
  { label: "INFO", value: "6" },
  { label: "DEBUG", value: "7" },
];

function JournalLogs() {
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState("");
  const [unit, setUnit] = useState("");
  const [priority, setPriority] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const params = new URLSearchParams();
  if (unit) params.set("unit", unit);
  if (priority) params.set("priority", priority);
  const wsUrl = `/api/ws/logs/journalctl${params.size ? "?" + params : ""}`;

  const onMessage = useCallback((msg: WSMessage<string>) => {
    if (msg.type === "log" && !pausedRef.current) {
      setLines((p) => [...p.slice(-2000), msg.data]);
    }
  }, []);

  useWebSocket<WSMessage<string>>(wsUrl, onMessage);

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, paused]);

  const filtered = useMemo(() =>
    lines.filter((line) =>
      !search || line.toLowerCase().includes(search.toLowerCase())
    ),
  [lines, search]);

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/60" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter…"
            className="rounded border border-input bg-background pl-7 pr-3 py-1.5 text-xs outline-none focus:border-primary w-40"
          />
        </div>
        <input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="Unit (e.g. nginx)"
          className="rounded border border-input bg-background px-3 py-1.5 text-xs outline-none focus:border-primary w-40"
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="rounded border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
        >
          {JOURNAL_PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <button
          onClick={() => setPaused((p) => !p)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={() => setLines([])}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Trash2 className="size-3" /> Clear
        </button>
        <span className="ml-auto text-xs text-muted-foreground/50">{filtered.length} lines</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs bg-slate-950 text-slate-300 rounded-xl border border-border">
        {filtered.length === 0 ? (
          <span className="text-muted-foreground/50">
            {paused ? "Stream paused — resume to see new events." : "Waiting for events…"}
          </span>
        ) : (
          filtered.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all text-green-400/70 leading-5">{line}</div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = "server" | "journal";

export function Logs() {
  const [tab, setTab] = useState<Tab>("server");

  return (
    <div className="flex flex-col gap-4" style={{ height: "calc(100vh - 6rem)" }}>
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Logs</h1>
          <p className="text-sm text-muted-foreground">Server activity</p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
          {(["server", "journal"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 transition-colors ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"}`}
            >
              {t === "server" ? "Server" : "Journalctl"}
            </button>
          ))}
        </div>
      </div>

      {tab === "server" ? <ServerLogs /> : <JournalLogs />}
    </div>
  );
}
