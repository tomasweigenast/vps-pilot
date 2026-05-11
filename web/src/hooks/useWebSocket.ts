import { useEffect, useRef, useState } from "react";

type Status = "connecting" | "open" | "closed";

const MAX_BACKOFF_MS = 30_000;

function buildWsUrl(path: string): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${path}`;
}

export function useWebSocket<T>(
  path: string,
  onMessage: (data: T) => void,
  enabled = true
): { status: Status } {
  const [status, setStatus] = useState<Status>("connecting");
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!enabled) return;

    let ws: WebSocket | null = null;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dead = false; // set to true on cleanup to stop reconnects

    function connect() {
      if (dead) return;

      ws = new WebSocket(buildWsUrl(path));
      setStatus("connecting");

      ws.onopen = () => {
        attempts = 0;
        setStatus("open");
      };

      ws.onmessage = (evt) => {
        try {
          onMessageRef.current(JSON.parse(evt.data as string) as T);
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        // onclose fires right after onerror — handle reconnect there
      };

      ws.onclose = () => {
        if (dead) return; // component unmounted, stop
        setStatus("closed");
        const delay = Math.min(1_000 * 2 ** attempts, MAX_BACKOFF_MS);
        attempts += 1;
        timer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      dead = true;
      if (timer !== null) clearTimeout(timer);
      ws?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled]);

  return { status };
}
