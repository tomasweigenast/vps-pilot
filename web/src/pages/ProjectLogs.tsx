import { useState, useRef, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ArrowLeft, Wifi, WifiOff, Trash2 } from "lucide-react";
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

export function ProjectLogs() {
  const { name } = useParams<{ name: string }>();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [selectedService, setSelectedService] = useState<string>("all");
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  const { status } = useWebSocket<WSMessage<unknown>>(
    `/api/ws/projects/${name}/logs`,
    (msg) => {
      if (msg.type === "services") {
        const names = msg.data as string[];
        setServices(names);
      } else if (msg.type === "log") {
        setLines((prev) => [...prev.slice(-2000), parseLogLine(msg.data as string)]);
      }
    }
  );

  useEffect(() => {
    if (autoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines]);

  const filtered = useMemo(
    () =>
      selectedService === "all"
        ? lines
        : lines.filter((l) => l.container === selectedService),
    [lines, selectedService]
  );

  return (
    <div className="flex flex-col h-full gap-4" style={{ height: "calc(100vh - 6rem)" }}>
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <Link to="/projects" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm text-muted-foreground">Logs</span>

        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {services.length > 0 && (
            <select
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value)}
              className="rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-primary"
            >
              <option value="all">All services</option>
              {services.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}

          <div className={`flex items-center gap-1.5 text-xs ${status === "open" ? "text-green-400" : "text-muted-foreground"}`}>
            {status === "open" ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
            {status}
          </div>
          <button
            onClick={() => setLines([])}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Trash2 className="size-3" /> Clear
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden rounded-xl border border-border bg-slate-950">
        <div
          className="h-full overflow-y-auto p-4 font-mono text-xs leading-5 bg-slate-950 text-slate-200"
          onScroll={(e) => {
            const el = e.currentTarget;
            autoScroll.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
          }}
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
                {services.length > 1 && selectedService === "all" && (
                  <span className="text-purple-400/70 mr-2">[{line.container}]</span>
                )}
                <span className="text-green-400/80">{line.log}</span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
