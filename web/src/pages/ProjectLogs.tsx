import { useState, useRef, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ArrowLeft, Wifi, WifiOff, Trash2 } from "lucide-react";
import type { WSMessage } from "@/types";

export function ProjectLogs() {
  const { name } = useParams<{ name: string }>();
  const [lines, setLines] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  const { status } = useWebSocket<WSMessage<string>>(
    `/api/ws/projects/${name}/logs`,
    (msg) => {
      if (msg.type === "log") {
        setLines((prev) => [...prev.slice(-2000), msg.data]);
      }
    }
  );

  useEffect(() => {
    if (autoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines]);

  return (
    <div className="flex flex-col h-full gap-4" style={{ height: "calc(100vh - 6rem)" }}>
      <div className="flex items-center gap-3 shrink-0">
        <Link to="/projects" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm text-muted-foreground">Logs</span>

        <div className="ml-auto flex items-center gap-3">
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
          {lines.length === 0 ? (
            <span className="text-muted-foreground/50">
              {status === "connecting" ? "Connecting…" : "Waiting for logs…"}
            </span>
          ) : (
            lines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all text-green-400/80 hover:text-green-400 transition-colors">
                {line}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
