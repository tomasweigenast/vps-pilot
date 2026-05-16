import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Network, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { listAllNetworks } from "@/api/docker";
import type { NetworkSummary } from "@/types";

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

export function Networks() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  const { data: networks, isLoading } = useQuery({
    queryKey: ["networks"],
    queryFn: listAllNetworks,
  });

  const projects = [...new Set((networks ?? []).map((n) => n.associatedProject).filter(Boolean))].sort();

  const filtered = (networks ?? []).filter((n) => {
    const matchSearch = !search || n.name.toLowerCase().includes(search.toLowerCase());
    const matchProject = !projectFilter || n.associatedProject === projectFilter;
    return matchSearch && matchProject;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Network className="size-4 text-muted-foreground" />
            Networks
          </h1>
          <p className="text-xs text-muted-foreground">{networks?.length ?? 0} networks total</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search networks…"
            className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50"
        >
          <option value="">All projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div
          className="grid gap-x-3 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider px-4 py-2.5 border-b border-border"
          style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 80px 80px" }}
        >
          <span>Name</span>
          <span>Driver</span>
          <span>Scope</span>
          <span>Project</span>
          <span>Internal</span>
          <span>Status</span>
        </div>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
            <span className="live-dot size-1.5 rounded-full bg-primary inline-block mr-2" />
            Loading…
          </div>
        ) : !filtered.length ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
            {networks?.length ? "No networks match your filters." : "No networks found."}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {filtered.map((n: NetworkSummary) => (
              <div
                key={n.id}
                className="grid gap-x-3 items-center text-xs px-4 py-2.5 hover:bg-secondary/30 transition-colors cursor-pointer"
                style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 80px 80px" }}
                onClick={() => navigate(`/networks/${n.id}`)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Network className="size-3 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate hover:text-primary">{n.name}</span>
                </div>
                <span className="font-mono text-muted-foreground">{n.driver}</span>
                <span className="text-muted-foreground">{n.scope}</span>
                <span className="text-muted-foreground truncate">{n.associatedProject || "—"}</span>
                <span className="text-muted-foreground">{n.internal ? "Yes" : "No"}</span>
                <InUseBadge inUse={n.inUse} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
