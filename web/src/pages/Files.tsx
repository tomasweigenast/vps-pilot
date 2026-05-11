import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listFiles } from "@/api/files";
import { Folder, File, Download, ChevronRight, Home } from "lucide-react";

function bytes(n: number) {
  if (!n) return "—";
  const k = 1024, u = ["B","KB","MB","GB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / k ** i).toFixed(1)} ${u[i]}`;
}

export function Files() {
  const [path, setPath] = useState("/");
  const { data, isLoading } = useQuery({
    queryKey: ["files", path],
    queryFn: () => listFiles(path),
  });

  const breadcrumbs = path.split("/").filter(Boolean);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Files</h1>
        <p className="text-sm text-muted-foreground">Read-only browser</p>
      </div>

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <button onClick={() => setPath("/")} className="hover:text-foreground transition-colors">
          <Home className="size-3.5" />
        </button>
        {breadcrumbs.map((part, i) => {
          const to = "/" + breadcrumbs.slice(0, i + 1).join("/");
          return (
            <span key={to} className="flex items-center gap-1">
              <ChevronRight className="size-3" />
              <button onClick={() => setPath(to)} className="hover:text-foreground transition-colors">
                {part}
              </button>
            </span>
          );
        })}
      </nav>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-xs font-mono text-muted-foreground">{path}</h2>
        </div>

        {isLoading ? (
          <div className="p-5 space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-7 rounded bg-secondary animate-pulse" />
            ))}
          </div>
        ) : !data?.length ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            Empty directory
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.map((entry) => (
              <div key={entry.path} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-secondary/30 transition-colors">
                {entry.isDir
                  ? <Folder className="size-4 text-primary/60 shrink-0" />
                  : <File className="size-4 text-muted-foreground/40 shrink-0" />}

                {entry.isDir ? (
                  <button className="flex-1 text-left hover:text-primary transition-colors" onClick={() => setPath(entry.path)}>
                    {entry.name}
                  </button>
                ) : (
                  <span className="flex-1 text-muted-foreground">{entry.name}</span>
                )}

                <span className="text-xs font-mono text-muted-foreground/50 shrink-0">{bytes(entry.size)}</span>

                {!entry.isDir && (
                  <a
                    href={`/files/download?path=${encodeURIComponent(entry.path)}`}
                    download
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Download className="size-3.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
