import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { getMetrics, getSystemInfo } from "@/api/metrics";
import { api } from "@/api/client";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { MetricsSnapshot, WSMessage, HostInfo } from "@/types";
import { cn } from "@/lib/utils";

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

type HistoryRange = "1h" | "6h" | "24h" | "7d";

interface HistoryPoint {
  recordedAt: string;
  cpuPercent: number;
  memUsed: number;
  memTotal: number;
  diskUsed: number;
  diskTotal: number;
  netBytesSent: number;
  netBytesRecv: number;
}

function formatTs(iso: string, range: HistoryRange): string {
  const d = new Date(iso);
  if (range === "7d") {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function MetricsCharts({ range }: { range: HistoryRange }) {
  const { data: points = [], isLoading } = useQuery<HistoryPoint[]>({
    queryKey: ["metrics-history", range],
    queryFn: () => api.get<HistoryPoint[]>(`/api/metrics/history?range=${range}`),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-40 rounded-lg bg-secondary/30 animate-pulse" />
        ))}
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        No data yet — metrics are stored every 30 seconds.
      </p>
    );
  }

  const chartData = points.map((p) => ({
    t: formatTs(p.recordedAt, range),
    cpu: parseFloat(p.cpuPercent.toFixed(1)),
    memPct: p.memTotal > 0 ? parseFloat(((p.memUsed / p.memTotal) * 100).toFixed(1)) : 0,
    diskPct: p.diskTotal > 0 ? parseFloat(((p.diskUsed / p.diskTotal) * 100).toFixed(1)) : 0,
  }));

  const tickCount = range === "7d" ? 7 : range === "24h" ? 8 : range === "6h" ? 6 : 6;

  const chartProps = {
    margin: { top: 4, right: 8, left: -20, bottom: 0 },
  };

  const axisStyle = { fontSize: 10, fill: "var(--muted-foreground)" };
  const gridStyle = { stroke: "var(--border)", strokeOpacity: 0.4 };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* CPU */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">CPU %</p>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={chartData} {...chartProps}>
            <defs>
              <linearGradient id="cpu-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} {...gridStyle} />
            <XAxis dataKey="t" tick={axisStyle} tickLine={false} axisLine={false} interval="preserveStartEnd" tickCount={tickCount} />
            <YAxis domain={[0, 100]} tick={axisStyle} tickLine={false} axisLine={false} unit="%" />
            <Tooltip
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 11 }}
              formatter={(v) => [`${v}%`, "CPU"]}
            />
            <Area type="monotone" dataKey="cpu" stroke="hsl(var(--primary))" strokeWidth={1.5} fill="url(#cpu-grad)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Memory */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">Memory %</p>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={chartData} {...chartProps}>
            <defs>
              <linearGradient id="mem-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} {...gridStyle} />
            <XAxis dataKey="t" tick={axisStyle} tickLine={false} axisLine={false} interval="preserveStartEnd" tickCount={tickCount} />
            <YAxis domain={[0, 100]} tick={axisStyle} tickLine={false} axisLine={false} unit="%" />
            <Tooltip
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 11 }}
              formatter={(v) => [`${v}%`, "Memory"]}
            />
            <Area type="monotone" dataKey="memPct" stroke="#22d3ee" strokeWidth={1.5} fill="url(#mem-grad)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Disk */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">Disk %</p>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={chartData} {...chartProps}>
            <defs>
              <linearGradient id="disk-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} {...gridStyle} />
            <XAxis dataKey="t" tick={axisStyle} tickLine={false} axisLine={false} interval="preserveStartEnd" tickCount={tickCount} />
            <YAxis domain={[0, 100]} tick={axisStyle} tickLine={false} axisLine={false} unit="%" />
            <Tooltip
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 11 }}
              formatter={(v) => [`${v}%`, "Disk"]}
            />
            <Area type="monotone" dataKey="diskPct" stroke="#f59e0b" strokeWidth={1.5} fill="url(#disk-grad)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function System() {
  const { data: initial } = useQuery({ queryKey: ["metrics"], queryFn: getMetrics, refetchInterval: 2000, staleTime: 0 });
  const [snap, setSnap] = useState<MetricsSnapshot | null>(null);
  const [histRange, setHistRange] = useState<HistoryRange>("1h");

  const { data: hostInfo } = useQuery<HostInfo>({
    queryKey: ["system-info"],
    queryFn: getSystemInfo,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

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

      {/* System Information */}
      {hostInfo && (
        <Section title="System Information">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Hostname</dt>
              <dd className="font-medium font-mono">{hostInfo.hostname}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">OS Information</dt>
              <dd className="font-medium">{hostInfo.os} {hostInfo.kernelArch} {hostInfo.platform} {hostInfo.platformVersion}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Kernel Version</dt>
              <dd className="font-medium font-mono">{hostInfo.kernelVersion}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total CPU</dt>
              <dd className="font-medium">{hostInfo.totalCpu > 0 ? hostInfo.totalCpu : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total Memory</dt>
              <dd className="font-medium">{hostInfo.totalMemoryBytes > 0 ? bytes(hostInfo.totalMemoryBytes) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Uptime</dt>
              <dd className="font-medium">{hostInfo.uptimeSeconds > 0 ? (() => {
                const d = Math.floor(hostInfo.uptimeSeconds / 86400);
                const h = Math.floor((hostInfo.uptimeSeconds % 86400) / 3600);
                const m = Math.floor((hostInfo.uptimeSeconds % 3600) / 60);
                if (d > 0) return `${d}d ${h}h ${m}m`;
                if (h > 0) return `${h}h ${m}m`;
                return `${m}m`;
              })() : "—"}</dd>
            </div>
            {hostInfo.virtualizationSystem && (
              <div>
                <dt className="text-xs text-muted-foreground">Virtualization</dt>
                <dd className="font-medium font-mono">{hostInfo.virtualizationSystem}</dd>
              </div>
            )}
          </dl>

          {hostInfo.engineInfo && (
            <div className="border-t border-border mt-4 pt-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Engine Details</p>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Version</dt>
                  <dd className="font-medium font-mono">
                    {hostInfo.dockerVersion}
                    {hostInfo.engineInfo.apiVersion && (
                      <span className="text-muted-foreground"> (API: {hostInfo.engineInfo.apiVersion})</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Root Directory</dt>
                  <dd className="font-medium font-mono truncate">{hostInfo.engineInfo.rootDir}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Storage Driver</dt>
                  <dd className="font-medium font-mono">{hostInfo.engineInfo.storageDriver}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Logging Driver</dt>
                  <dd className="font-medium font-mono">{hostInfo.engineInfo.loggingDriver}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Volume Plugins</dt>
                  <dd className="font-medium">{hostInfo.engineInfo.volumePlugins?.join(", ") || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Network Plugins</dt>
                  <dd className="font-medium truncate">{hostInfo.engineInfo.networkPlugins?.join(", ") || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Containers</dt>
                  <dd className="font-medium">
                    <span className="text-green-500">{hostInfo.engineInfo.containersRunning} running</span>
                    {" / "}
                    <span className="text-muted-foreground">{hostInfo.engineInfo.containersStopped} stopped</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Images</dt>
                  <dd className="font-medium">{hostInfo.engineInfo.imageCount}</dd>
                </div>
              </dl>
            </div>
          )}
        </Section>
      )}

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

      {/* Historical charts */}
      <Section title="History">
        <div className="flex items-center gap-1 mb-4">
          {(["1h", "6h", "24h", "7d"] as HistoryRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setHistRange(r)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                histRange === r
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <MetricsCharts range={histRange} />
      </Section>
    </div>
  );
}
