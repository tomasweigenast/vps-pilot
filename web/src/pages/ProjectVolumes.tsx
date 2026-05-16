import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";
import { listProjectVolumes } from "@/api/docker";
import type { VolumeSummary } from "@/types";

function InUseBadge({ inUse }: { inUse: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
      inUse
        ? "bg-green-500/10 text-green-400 ring-green-500/20"
        : "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20"
    )}>
      <span className={cn("size-1.5 rounded-full", inUse ? "bg-green-400" : "bg-zinc-500")} />
      {inUse ? "In use" : "Unused"}
    </span>
  );
}

export function ProjectVolumes() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const { data: volumes, isLoading } = useQuery({
    queryKey: ["project-volumes", name],
    queryFn: () => listProjectVolumes(name!),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to={`/projects/${name}`} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <HardDrive className="size-4 text-muted-foreground" />
            Volumes
          </h1>
          <p className="text-xs text-muted-foreground">{name}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div
          className="grid gap-x-3 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider px-4 py-2.5 border-b border-border"
          style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) minmax(0,2fr) 80px" }}
        >
          <span>Name</span>
          <span>Driver</span>
          <span>Mountpoint</span>
          <span>Status</span>
        </div>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
            <span className="live-dot size-1.5 rounded-full bg-primary inline-block mr-2" />
            Loading…
          </div>
        ) : !volumes?.length ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
            No volumes found for this project.
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {volumes.map((v: VolumeSummary) => (
              <div
                key={v.name}
                className="grid gap-x-3 items-center text-xs px-4 py-2.5 hover:bg-secondary/30 transition-colors cursor-pointer"
                style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) minmax(0,2fr) 80px" }}
                onClick={() => navigate(`/projects/${name}/volumes/${encodeURIComponent(v.name)}`)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <HardDrive className="size-3 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate hover:text-primary">{v.name}</span>
                </div>
                <span className="font-mono text-muted-foreground">{v.driver}</span>
                <span className="font-mono text-muted-foreground text-[10px] truncate" title={v.mountpoint}>{v.mountpoint || "—"}</span>
                <InUseBadge inUse={v.inUse} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
