import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Folder, File, Download, ChevronRight, Home, ArrowLeft, Terminal } from "lucide-react";
import { api } from "@/api/client";

interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
  mode: string;
  modTime: string;
}

function bytes(n: number) {
  if (!n) return "—";
  const k = 1024, u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / k ** i).toFixed(1)} ${u[i]}`;
}

export function ContainerFiles() {
  const { name, id } = useParams<{ name: string; id: string }>();
  const [path, setPath] = useState("/");

  const { data, isLoading, error } = useQuery({
    queryKey: ["container-files", id, path],
    queryFn: () => api.get<DirEntry[]>(`/api/projects/${name}/containers/${id}/files?path=${encodeURIComponent(path)}`),
  });

  const breadcrumbs = path.split("/").filter(Boolean);

  const navigate = (entry: DirEntry) => {
    if (entry.isDir) {
      setPath(path.endsWith("/") ? path + entry.name : path + "/" + entry.name);
    }
  };

  const goTo = (idx: number) => {
    if (idx < 0) {
      setPath("/");
    } else {
      setPath("/" + breadcrumbs.slice(0, idx + 1).join("/"));
    }
  };

  const downloadUrl = (entry: DirEntry) => {
    const filePath = path.endsWith("/") ? path + entry.name : path + "/" + entry.name;
    return `/api/projects/${name}/containers/${id}/files/download?path=${encodeURIComponent(filePath)}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          to={`/projects`}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight truncate">
            Container Files
          </h1>
          <p className="text-sm text-muted-foreground font-mono truncate">{id}</p>
        </div>
        <Link
          to={`/projects/${name}/containers/${id}/shell`}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
        >
          <Terminal className="size-3.5" /> Shell
        </Link>
      </div>

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
        <button onClick={() => setPath("/")} className="hover:text-foreground transition-colors">
          <Home className="size-3.5" />
        </button>
        {breadcrumbs.map((part, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="size-3" />
            <button onClick={() => goTo(i)} className="hover:text-foreground transition-colors">
              {part}
            </button>
          </span>
        ))}
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
        ) : error ? (
          <div className="flex items-center justify-center py-12 text-sm text-destructive">
            {(error as Error).message}
          </div>
        ) : !data?.length ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            Empty directory
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.map((entry) => (
              <div
                key={entry.name}
                className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-secondary/30 transition-colors"
              >
                {entry.isDir
                  ? <Folder className="size-4 text-primary/60 shrink-0" />
                  : <File className="size-4 text-muted-foreground/40 shrink-0" />}

                {entry.isDir ? (
                  <button
                    className="flex-1 text-left hover:text-primary transition-colors font-mono text-xs"
                    onClick={() => navigate(entry)}
                  >
                    {entry.name}
                  </button>
                ) : (
                  <span className="flex-1 text-muted-foreground font-mono text-xs">{entry.name}</span>
                )}

                <span className="text-xs font-mono text-muted-foreground/50 shrink-0 hidden sm:block">
                  {entry.mode}
                </span>
                <span className="text-xs font-mono text-muted-foreground/50 shrink-0">
                  {bytes(entry.size)}
                </span>

                {!entry.isDir && (
                  <a
                    href={downloadUrl(entry)}
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
