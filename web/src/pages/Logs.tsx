import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLogHistory } from "@/api/logs";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Trash2 } from "lucide-react";
import type { LogEntry, WSMessage } from "@/types";

const levelStyle: Record<string, string> = {
  error: "text-red-400",
  warn: "text-yellow-400",
  warning: "text-yellow-400",
  info: "text-blue-400",
  debug: "text-zinc-500",
};

export function Logs() {
  const { data: history } = useQuery({ queryKey: ["logs-history"], queryFn: getLogHistory });
  const [streaming, setStreaming] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useWebSocket<WSMessage<string>>("/api/ws/logs", (msg) => {
    if (msg.type === "log") setStreaming((p) => [...p.slice(-1000), msg.data]);
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streaming]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Logs</h1>
        <p className="text-sm text-muted-foreground">Server activity</p>
      </div>

      {/* History */}
      {history && history.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">History</h2>
          </div>
          <div className="divide-y divide-border">
            {history.map((e) => <HistoryRow key={e.id} entry={e} />)}
          </div>
        </div>
      )}

      {/* Live */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Live stream</h2>
          <button
            onClick={() => setStreaming([])}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Trash2 className="size-3" /> Clear
          </button>
        </div>
        <div className="h-72 overflow-y-auto p-4 font-mono text-xs bg-slate-950 text-slate-300 rounded-b-xl">
          {streaming.length === 0 ? (
            <span className="text-muted-foreground/50">Waiting for events…</span>
          ) : (
            streaming.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all text-green-400/70 leading-5">{line}</div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ entry }: { entry: LogEntry }) {
  const level = entry.level.toLowerCase();
  return (
    <div className="flex items-start gap-3 px-5 py-3 text-xs hover:bg-secondary/30 transition-colors">
      <span className="shrink-0 text-muted-foreground/60 font-mono">
        {new Date(entry.timestamp).toLocaleTimeString()}
      </span>
      <span className={`shrink-0 font-medium w-10 uppercase ${levelStyle[level] ?? "text-muted-foreground"}`}>
        {entry.level.slice(0, 4)}
      </span>
      <span className="text-foreground/80 break-all">{entry.message}</span>
    </div>
  );
}
