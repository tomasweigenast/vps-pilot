import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Network, HardDrive, Cpu, CheckCircle2, XCircle, Clock, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { inspectContainer } from "@/api/docker";
import type { ContainerInspectResult } from "@/types";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function formatDate(iso: string): string {
  if (!iso || iso.startsWith("0001")) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

const healthColor: Record<string, string> = {
  healthy: "text-green-400",
  unhealthy: "text-red-400",
  starting: "text-yellow-400",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="px-4 py-2.5 border-b border-border">
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-4 py-1.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground w-32 shrink-0">{label}</span>
      <span className={cn("text-xs flex-1 min-w-0 break-all", mono && "font-mono")}>{value ?? "—"}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-green-500/15 text-green-400 ring-green-500/30",
    exited: "bg-zinc-500/15 text-zinc-400 ring-zinc-500/30",
    stopped: "bg-zinc-500/15 text-zinc-400 ring-zinc-500/30",
    paused: "bg-yellow-500/15 text-yellow-400 ring-yellow-500/30",
    restarting: "bg-blue-500/15 text-blue-400 ring-blue-500/30",
    dead: "bg-red-500/15 text-red-400 ring-red-500/30",
  };
  return (
    <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset capitalize", colors[status] ?? "bg-zinc-500/15 text-zinc-400 ring-zinc-500/30")}>
      {status}
    </span>
  );
}

function ContainerDetailView({ data }: { data: ContainerInspectResult }) {
  const { name: projectName } = useParams<{ name: string }>();

  const cmd = [...(data.entrypoint ?? []), ...(data.command ?? [])].join(" ");
  const hasHealth = !!data.state.health;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to={`/projects/${projectName}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">{data.name}</h1>
          <p className="text-xs text-muted-foreground font-mono">{data.id}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusBadge status={data.state.status} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Overview */}
        <Section title="Overview">
          <KV label="Image" value={data.image} mono />
          <KV label="Platform" value={data.platform} />
          <KV label="Created" value={formatDate(data.created)} />
          <KV label="Started at" value={formatDate(data.state.startedAt)} />
          {!data.state.running && (
            <KV label="Finished at" value={formatDate(data.state.finishedAt)} />
          )}
          {!data.state.running && (
            <KV label="Exit code" value={data.state.exitCode} />
          )}
          <KV label="Restart policy" value={data.restartPolicy || "none"} />
        </Section>

        {/* Health */}
        {hasHealth ? (
          <Section title="Health">
            <div className="flex items-center gap-2 mb-3">
              {data.state.health!.status === "healthy" ? (
                <CheckCircle2 className="size-4 text-green-400" />
              ) : data.state.health!.status === "unhealthy" ? (
                <XCircle className="size-4 text-red-400" />
              ) : (
                <Clock className="size-4 text-yellow-400" />
              )}
              <span className={cn("text-sm font-medium capitalize", healthColor[data.state.health!.status] ?? "text-muted-foreground")}>
                {data.state.health!.status}
              </span>
              {data.state.health!.failingStreak > 0 && (
                <span className="text-xs text-muted-foreground">({data.state.health!.failingStreak} consecutive failures)</span>
              )}
            </div>
            {data.state.health!.log?.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium mb-1">Recent checks</p>
                {data.state.health!.log.slice(-3).map((entry, i) => (
                  <div key={i} className="rounded bg-secondary/40 px-3 py-2 text-xs font-mono">
                    <div className="flex items-center justify-between mb-1">
                      <span className={entry.exitCode === 0 ? "text-green-400" : "text-red-400"}>
                        exit {entry.exitCode}
                      </span>
                      <span className="text-muted-foreground">{formatDate(entry.end)}</span>
                    </div>
                    {entry.output && (
                      <pre className="text-muted-foreground whitespace-pre-wrap text-[10px] leading-tight max-h-20 overflow-auto">
                        {entry.output.trim()}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        ) : (
          <Section title="Health">
            <p className="text-xs text-muted-foreground">No healthcheck configured for this container.</p>
          </Section>
        )}
      </div>

      {/* Command */}
      {cmd && (
        <Section title="Command">
          <pre className="text-xs font-mono bg-secondary/40 rounded px-3 py-2 whitespace-pre-wrap break-all">{cmd}</pre>
        </Section>
      )}

      {/* Ports */}
      {data.ports && data.ports.length > 0 && (
        <Section title="Ports">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-muted-foreground/60 uppercase tracking-wider border-b border-border">
                <th className="text-left pb-2">Private</th>
                <th className="text-left pb-2">Public</th>
                <th className="text-left pb-2">Protocol</th>
                <th className="text-left pb-2">Host IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {data.ports.map((p, i) => (
                <tr key={i}>
                  <td className="py-1.5 font-mono">{p.privatePort}</td>
                  <td className="py-1.5 font-mono">{p.publicPort || "—"}</td>
                  <td className="py-1.5">{p.type}</td>
                  <td className="py-1.5 font-mono text-muted-foreground">{p.ip || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Networks */}
        <Section title={`Networks (${data.networks?.length ?? 0})`}>
          {!data.networks?.length ? (
            <p className="text-xs text-muted-foreground">No networks.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-muted-foreground/60 uppercase tracking-wider border-b border-border">
                  <th className="text-left pb-2">Name</th>
                  <th className="text-left pb-2">IP</th>
                  <th className="text-left pb-2">Gateway</th>
                  <th className="text-left pb-2">MAC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.networks.map((n, i) => (
                  <tr key={i}>
                    <td className="py-1.5 font-medium flex items-center gap-1.5">
                      <Network className="size-3 text-muted-foreground" />
                      {n.name}
                    </td>
                    <td className="py-1.5 font-mono">{n.ip || "—"}</td>
                    <td className="py-1.5 font-mono text-muted-foreground">{n.gateway || "—"}</td>
                    <td className="py-1.5 font-mono text-muted-foreground text-[10px]">{n.mac || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Mounts */}
        <Section title={`Volumes / Mounts (${data.mounts?.length ?? 0})`}>
          {!data.mounts?.length ? (
            <p className="text-xs text-muted-foreground">No mounts.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-muted-foreground/60 uppercase tracking-wider border-b border-border">
                  <th className="text-left pb-2">Type</th>
                  <th className="text-left pb-2">Source</th>
                  <th className="text-left pb-2">Destination</th>
                  <th className="text-left pb-2">Mode</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.mounts.map((m, i) => (
                  <tr key={i}>
                    <td className="py-1.5">
                      <span className="flex items-center gap-1">
                        <HardDrive className="size-3 text-muted-foreground" />
                        {m.type}
                      </span>
                    </td>
                    <td className="py-1.5 font-mono text-muted-foreground truncate max-w-[160px]" title={m.source || m.name}>
                      {m.name || m.source || "—"}
                    </td>
                    <td className="py-1.5 font-mono truncate max-w-[160px]" title={m.destination}>{m.destination}</td>
                    <td className="py-1.5">
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded", m.rw ? "bg-green-500/10 text-green-400" : "bg-zinc-500/10 text-zinc-400")}>
                        {m.rw ? "rw" : "ro"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      {/* Environment Variables */}
      {data.env && data.env.length > 0 && (
        <Section title={`Environment Variables (${data.env.length})`}>
          <div className="max-h-64 overflow-y-auto space-y-0">
            {data.env.map((e, i) => {
              const [k, ...rest] = e.split("=");
              const v = rest.join("=");
              return (
                <div key={i} className="flex gap-3 py-1 border-b border-border/30 last:border-0">
                  <span className="text-xs font-mono text-primary/80 w-48 shrink-0 truncate">{k}</span>
                  <span className="text-xs font-mono text-muted-foreground truncate flex-1">{v}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Labels */}
      {data.labels && Object.keys(data.labels).length > 0 && (
        <Section title={`Labels (${Object.keys(data.labels).length})`}>
          <div className="max-h-48 overflow-y-auto space-y-0">
            {Object.entries(data.labels).map(([k, v]) => (
              <div key={k} className="flex gap-3 py-1 border-b border-border/30 last:border-0">
                <span className="text-xs font-mono text-muted-foreground w-64 shrink-0 truncate">{k}</span>
                <span className="text-xs font-mono text-foreground/60 truncate flex-1">{v}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

export function ContainerDetail() {
  const { name: projectName, id } = useParams<{ name: string; id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["container-inspect", projectName, id],
    queryFn: () => inspectContainer(projectName!, id!),
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground text-sm">
        <span className="live-dot size-1.5 rounded-full bg-primary inline-block mr-2" />
        Loading…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground text-sm">
        Failed to load container details.
      </div>
    );
  }

  return <ContainerDetailView data={data} />;
}
