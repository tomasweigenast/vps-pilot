import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuditLog {
  id: number;
  createdAt: string;
  username: string;
  action: string;
  resource: string;
  detail: string;
  ip: string;
}

interface AuditResponse {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

const actionCategory = (action: string): "auth" | "project" | "container" | "file" | "other" => {
  if (action.startsWith("auth.")) return "auth";
  if (action.startsWith("container.")) return "container";
  if (action.startsWith("project.file.")) return "file";
  if (action.startsWith("project.")) return "project";
  return "other";
};

const categoryColor: Record<string, string> = {
  auth: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  project: "bg-green-500/15 text-green-400 border-green-500/20",
  container: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  file: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  other: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
};

function ActionBadge({ action }: { action: string }) {
  const cat = actionCategory(action);
  return (
    <span className={cn(
      "inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-mono",
      categoryColor[cat]
    )}>
      {action}
    </span>
  );
}

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "medium",
    });
  } catch {
    return iso;
  }
}

const PAGE_SIZE = 50;

export function AuditLogs() {
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["audit", offset],
    queryFn: () => api.get<AuditResponse>(`/api/audit?limit=${PAGE_SIZE}&offset=${offset}`),
    staleTime: 0,
  });

  const total = data?.total ?? 0;
  const pages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit Logs</h1>
        <p className="text-sm text-muted-foreground">{total} total entries</p>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/20">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">Time</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">User</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Action</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Resource</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(5)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 rounded bg-secondary animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : !data?.logs?.length ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No audit logs yet
                  </td>
                </tr>
              ) : (
                data.logs.map((log) => (
                  <tr key={log.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {fmt(log.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-medium">{log.username}</td>
                    <td className="px-4 py-2.5">
                      <ActionBadge action={log.action} />
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground max-w-[200px] truncate">
                      {log.resource || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">
                      {log.ip || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
            <span className="text-xs text-muted-foreground">
              Page {currentPage} of {pages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0}
                className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total}
                className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
