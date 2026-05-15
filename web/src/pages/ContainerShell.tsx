import { useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { Terminal as TerminalIcon, ArrowLeft, FolderOpen } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export function ContainerShell() {
  const { name, id } = useParams<{ name: string; id: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current || !name || !id) return;

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: "#09090b",
        foreground: "#e4e4e7",
        cursor: "#a1a1aa",
        selectionBackground: "#3f3f46",
        black: "#18181b",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e4e4e7",
        brightBlack: "#52525b",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#fde047",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#67e8f9",
        brightWhite: "#fafafa",
      },
      fontFamily: '"Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.4,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/api/ws/projects/${name}/containers/${id}/exec`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      term.writeln("\x1b[32mConnected to container shell.\x1b[0m");
      term.writeln("\x1b[90mType 'exit' to close the shell.\x1b[0m\r\n");
      // Send initial terminal size
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      }
    };

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(ev.data));
      } else {
        term.write(ev.data as string);
      }
    };

    ws.onclose = () => {
      term.writeln("\r\n\x1b[31mConnection closed.\x1b[0m");
    };

    ws.onerror = () => {
      term.writeln("\r\n\x1b[31mWebSocket error.\x1b[0m");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
        }
      }
    });
    if (containerRef.current.parentElement) {
      observer.observe(containerRef.current.parentElement);
    }

    return () => {
      observer.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      fitRef.current = null;
    };
  }, [name, id]);

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] gap-4">
      <div className="flex items-center gap-3 shrink-0">
        <Link to="/projects" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <TerminalIcon className="size-5 text-primary" />
            Container Shell
          </h1>
          <p className="text-sm text-muted-foreground font-mono truncate">{id}</p>
        </div>
        <Link
          to={`/projects/${name}/containers/${id}/files`}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
        >
          <FolderOpen className="size-3.5" /> Files
        </Link>
      </div>

      <div className="flex-1 rounded-xl border border-border bg-[#09090b] overflow-hidden min-h-0">
        <div ref={containerRef} className="h-full p-1" />
      </div>
    </div>
  );
}
