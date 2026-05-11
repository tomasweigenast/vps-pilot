import { useEffect, useRef, useState, useCallback } from "react";

type Status = "connecting" | "open" | "closed";

const MAX_BACKOFF_MS = 30_000;

function buildWsUrl(path: string): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  // In dev mode Vite runs on :5173 but Go runs on :8080.
  // WebSocket upgrade proxying in Vite is unreliable; connect directly to Go.
  const host = import.meta.env.DEV
    ? `${location.hostname}:8080`
    : location.host;
  return `${protocol}//${host}${path}`;
}

export function useWebSocket<T>(
  path: string,
  onMessage: (data: T) => void,
  enabled = true
): { status: Status } {
  const [status, setStatus] = useState<Status>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!enabled) return;
    const ws = new WebSocket(buildWsUrl(path));
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      setStatus("open");
      attemptsRef.current = 0;
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as T;
        onMessageRef.current(msg);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setStatus("closed");
      if (!enabled) return;
      const delay = Math.min(1_000 * 2 ** attemptsRef.current, MAX_BACKOFF_MS);
      attemptsRef.current += 1;
      timerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [path, enabled]);

  useEffect(() => {
    if (!enabled) return;
    connect();
    return () => {
      enabled && (attemptsRef.current = Infinity); // prevent reconnect on unmount
      timerRef.current && clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [connect, enabled]);

  return { status };
}
