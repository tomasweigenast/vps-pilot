import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useWebSocket } from "@/hooks/useWebSocket";
import {
  ArrowLeft, Wifi, WifiOff, Trash2, Search, ArrowDown,
  Play, Pause,
} from "lucide-react";
import type { WSMessage } from "@/types";

interface LogLine {
  container: string;
  log: string;
  time: string;
}

function parseLogLine(raw: string): LogLine {
  try {
    const parsed = JSON.parse(raw) as LogLine;
    if (parsed && parsed.log !== undefined) return parsed;
  } catch { /* fall through */ }
  return { container: "", log: raw, time: new Date().toISOString() };
}

const TAIL_OPTIONS = [
  { label: "50", value: "50" },
  { label: "100", value: "100" },
  { label: "200", value: "200" },
  { label: "500", value: "500" },
  { label: "1000", value: "1000" },
  { label: "All", value: "all" },
];

export function ProjectLogs() {
  const { name } = useParams<{ name: string }>();

  // Log stream options
  const [tail, setTail] = useState("200");
  const [follow, setFollow] = useState(true);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  // UI state
  const [lines, setLines] = useState<LogLine[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [selectedService, setSelectedService] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [atBottom, setAtBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Build WS URL from options — changing any param reconnects automatically.
  const wsUrl = useMemo(() => {
    const params = new URLSearchParams({ tail, follow: String(follow) });
    if (since) params.set("since", new Date(since).toISOString());
    if (until) params.set("until", new Date(until).toISOString());
    return `/api/ws/projects/${name}/logs?${params}`;
  }, [name, tail, follow, since, until]);

  const { status } = useWebSocket<WSMessage<unknown>>(
    wsUrl,
    (msg) => {
      if (msg.type === "services") {
        setServices(msg.data as string[]);
      } else if (msg.type === "log") {
        setLines((prev) => [...prev.slice(-5000), parseLogLine(msg.data as string)]);
      }
    }
  );

  // Auto-scroll when following
  useEffect(() => {
    if (follow && atBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, follow, atBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 80);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setAtBottom(true);
  }, []);

  // Clear: clears lines for the selected service (or all)
  const clearLogs = useCallback(() => {
    if (selectedService === "all") {
      setLines([]);
    } else {
      setLines((prev) => prev.filter((l) => l.container !== selectedService));
    }
  }, [selectedService]);

  const filtered = useMemo(() => {
    let result = selectedService === "all"
      ? lines
      : lines.filter((l) => l.container === selectedService);
    if (search) {
      const lo = search.toLowerCase();
      result = result.filter((l) => l.log.toLowerCase().includes(lo));
    }
    return result;
  }, [lines, selectedService, search]);

  return (
    <div className="flex flex-col h-full gap-3" style={{ height: "calc(100vh - 6rem)" }}>
      {/* Top bar */}
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <Link to="/projects" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm text-muted-foreground">Logs</span>

        <div className={`ml-auto flex items-center gap-1.5 text-xs ${status === "open" ? "text-green-400" : "text-muted-foreground"}`}>
          {status === "open" ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
          {status}
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search logs…"
            className="rounded-md border border-input bg-background pl-7 pr-3 py-1.5 text-xs outline-none focus:border-primary w-44"
          />
        </div>

        {/* Service filter */}
        {services.length > 0 && (
          <select
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
          >
            <option value="all">All services</option>
            {services.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}

        {/* Tail */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Tail</span>
          <select
            value={tail}
            onChange={(e) => { setTail(e.target.value); setLines([]); }}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
          >
            {TAIL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Follow toggle */}
        <button
          onClick={() => setFollow((v) => !v)}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
            follow
              ? "border-primary/40 text-primary bg-primary/5"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {follow ? <Pause className="size-3" /> : <Play className="size-3" />}
          Follow
        </button>

        {/* Since */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Since</span>
          <input
            type="datetime-local"
            value={since}
            onChange={(e) => { setSince(e.target.value); setLines([]); }}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
          />
        </div>

        {/* Until */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Until</span>
          <input
            type="datetime-local"
            value={until}
            onChange={(e) => { setUntil(e.target.value); setLines([]); }}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
          />
        </div>

        {/* Clear */}
        <button
          onClick={clearLogs}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
        >
          <Trash2 className="size-3" /> Clear
        </button>
      </div>

      {/* Log area */}
      <div className="relative flex-1 overflow-hidden rounded-xl border border-border bg-slate-950">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto p-4 font-mono text-xs leading-5 bg-slate-950 text-slate-200"
        >
          {filtered.length === 0 ? (
            <span className="text-muted-foreground/50">
              {status === "connecting" ? "Connecting…" : "Waiting for logs…"}
            </span>
          ) : (
            filtered.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all hover:bg-white/5 transition-colors">
                <span className="text-slate-500 mr-2 select-none">
                  {new Date(line.time).toLocaleTimeString()}
                </span>
                {services.length > 1 && selectedService === "all" && line.container && (
                  <span className="text-purple-400/70 mr-2">[{line.container.replace(name + "-", "")}]</span>
                )}
                <span className="text-green-400/80">{line.log}</span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Scroll-to-bottom button */}
        {!atBottom && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full border border-border bg-card/90 backdrop-blur px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground shadow-lg transition-colors"
          >
            <ArrowDown className="size-3" /> Bottom
          </button>
        )}
      </div>

      {/* Footer: line count */}
      <p className="shrink-0 text-xs text-muted-foreground/50 text-right">
        {filtered.length} line{filtered.length !== 1 ? "s" : ""}
        {search ? " (filtered)" : ""}
      </p>
    </div>
  );
}
