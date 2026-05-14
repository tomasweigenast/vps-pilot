import { useWebSocket } from "@/hooks/useWebSocket";
import type { MetricsSnapshot, WSMessage } from "@/types";
import { Cpu, HardDrive, MemoryStick, Wifi } from "lucide-react";
import { useState } from "react";

function bytes(n: number): string {
  if (!n) return "0 B";
  const k = 1024;
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / k ** i).toFixed(1)} ${u[i]}`;
}

function MetricCard({
  label,
  value,
  sub,
  pct,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  pct: number;
  icon: React.ElementType;
}) {
  const color = pct > 90 ? "bg-destructive" : pct > 70 ? "bg-yellow-500" : "bg-primary";
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <Icon className="size-4 text-muted-foreground/50" />
      </div>
      <div>
        <span className="text-3xl font-mono font-bold tracking-tight">{value}</span>
        <p className="text-xs text-muted-foreground mt-1">{sub}</p>
      </div>
      <div className="space-y-1">
        <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${color}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">{pct.toFixed(1)}%</p>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [snap, setSnap] = useState<MetricsSnapshot | null>(null);
  const { status: wsStatus } = useWebSocket<WSMessage<MetricsSnapshot>>(
    "/api/ws/metrics",
    (msg) => { if (msg.type === "metrics") setSnap(msg.data); }
  );

  const data = snap;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">System overview</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={`live-dot size-1.5 rounded-full inline-block ${wsStatus === "open" ? "bg-green-500" : "bg-muted-foreground"}`} />
          {wsStatus === "open" ? "Live" : wsStatus}
        </div>
      </div>

      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-36 rounded-xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="CPU"
              icon={Cpu}
              value={`${data.cpu.usagePercent.toFixed(1)}%`}
              sub={`${data.cpu.cores} cores`}
              pct={data.cpu.usagePercent}
            />
            <MetricCard
              label="Memory"
              icon={MemoryStick}
              value={bytes(data.memory.used)}
              sub={`of ${bytes(data.memory.total)}`}
              pct={data.memory.usedPercent}
            />
            {data.disks.slice(0, 2).map((d) => (
              <MetricCard
                key={d.path}
                label={`Disk ${d.path}`}
                icon={HardDrive}
                value={bytes(d.used)}
                sub={`of ${bytes(d.total)}`}
                pct={d.usedPercent}
              />
            ))}
          </div>

          {data.network.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Wifi className="size-4 text-muted-foreground/50" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Network</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.network.map((n) => (
                  <div key={n.interface} className="rounded-lg bg-secondary/50 px-4 py-3">
                    <p className="text-xs font-medium mb-2 text-foreground">{n.interface}</p>
                    <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                      <span>↓ {bytes(n.bytesRecv)}</span>
                      <span>↑ {bytes(n.bytesSent)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
