import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMetrics } from "@/api/metrics";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { MetricsSnapshot, WSMessage } from "@/types";

function bytes(n: number) {
  if (!n) return "0 B";
  const k = 1024, u = ["B","KB","MB","GB","TB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / k ** i).toFixed(1)} ${u[i]}`;
}

function Bar({ pct }: { pct: number }) {
  const color = pct > 90 ? "bg-destructive" : pct > 70 ? "bg-yellow-500" : "bg-primary";
  return (
    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export function System() {
  const { data: initial } = useQuery({ queryKey: ["metrics"], queryFn: getMetrics });
  const [snap, setSnap] = useState<MetricsSnapshot | null>(null);

  useWebSocket<WSMessage<MetricsSnapshot>>("/api/ws/metrics", (msg) => {
    if (msg.type === "metrics") setSnap(msg.data);
  });

  const data = snap ?? initial;

  if (!data) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-28 rounded-xl border border-border bg-card animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">System</h1>
        <p className="text-sm text-muted-foreground">Hardware metrics</p>
      </div>

      <Section title="CPU">
        <div className="flex items-center justify-between text-sm mb-3">
          <span className="text-muted-foreground">{data.cpu.cores} cores</span>
          <span className="font-mono font-semibold">{data.cpu.usagePercent.toFixed(2)}%</span>
        </div>
        <Bar pct={data.cpu.usagePercent} />
      </Section>

      <Section title="Memory">
        <div className="flex items-center justify-between text-sm mb-3">
          <span className="text-muted-foreground">{bytes(data.memory.used)} / {bytes(data.memory.total)}</span>
          <span className="font-mono font-semibold">{data.memory.usedPercent.toFixed(2)}%</span>
        </div>
        <Bar pct={data.memory.usedPercent} />
        <p className="text-xs text-muted-foreground mt-2">Available: {bytes(data.memory.available)}</p>
      </Section>

      <Section title="Disks">
        <div className="space-y-4">
          {data.disks.map((d) => (
            <div key={d.path}>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="font-mono text-xs text-muted-foreground">{d.path}</span>
                <span className="font-mono text-xs">{bytes(d.used)} / {bytes(d.total)}</span>
              </div>
              <Bar pct={d.usedPercent} />
            </div>
          ))}
        </div>
      </Section>

      {data.network.length > 0 && (
        <Section title="Network">
          <div className="space-y-4">
            {data.network.map((n) => (
              <div key={n.interface} className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
                <div className="col-span-2 font-medium text-sm mb-1">{n.interface}</div>
                <span className="text-muted-foreground">Bytes sent</span><span className="font-mono">{bytes(n.bytesSent)}</span>
                <span className="text-muted-foreground">Bytes recv</span><span className="font-mono">{bytes(n.bytesRecv)}</span>
                <span className="text-muted-foreground">Pkts sent</span><span className="font-mono">{n.packetsSent.toLocaleString()}</span>
                <span className="text-muted-foreground">Pkts recv</span><span className="font-mono">{n.packetsRecv.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
