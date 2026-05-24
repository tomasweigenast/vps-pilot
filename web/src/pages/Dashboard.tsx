import { useWebSocket } from "@/hooks/useWebSocket";
import { useQuery } from "@tanstack/react-query";
import type { MetricsSnapshot, WSMessage } from "@/types";
import { Cpu, HardDrive, MemoryStick, Wifi, Server } from "lucide-react";
import { useState } from "react";
import { getSystemInfo } from "@/api/metrics";

function bytes(n: number): string {
  if (!n) return "0 B";
  const k = 1024;
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / k ** i).toFixed(1)} ${u[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
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

  const { data: hostInfo } = useQuery({
    queryKey: ["system-info"],
    queryFn: getSystemInfo,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

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

      {/* Host info card */}
      {hostInfo && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-5">
          {/* Host Details */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Server className="size-4 text-muted-foreground/50" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Host Details</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Hostname</dt>
                <dd className="font-medium font-mono truncate">{hostInfo.hostname}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">OS</dt>
                <dd className="font-medium truncate">{hostInfo.os} {hostInfo.kernelArch}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">OS Information</dt>
                <dd className="font-medium truncate">{hostInfo.platform} {hostInfo.platformVersion}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Kernel Version</dt>
                <dd className="font-medium font-mono truncate">{hostInfo.kernelVersion}</dd>
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
                <dd className="font-medium">{formatUptime(hostInfo.uptimeSeconds)}</dd>
              </div>
              {hostInfo.virtualizationSystem && (
                <div>
                  <dt className="text-xs text-muted-foreground">Virtualization</dt>
                  <dd className="font-medium font-mono">{hostInfo.virtualizationSystem}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Engine Details */}
          {hostInfo.engineInfo && (
            <div className="border-t border-border pt-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Engine Details</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
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
        </div>
      )}

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
