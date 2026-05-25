import { Server, Terminal } from "lucide-react";

/**
 * Setup page — shown when no users exist in the database.
 * Initial setup is performed via `vps-pilot install` (creates the admin user).
 * This page explains that and provides no interactive form.
 */
export function Setup() {
  return (
    <div className="grid-bg flex min-h-screen items-center justify-center bg-background p-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 size-96 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="rounded-xl border border-border bg-card p-8 shadow-2xl shadow-black/50 space-y-6">
          <div className="flex flex-col items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/30">
              <Server className="size-5 text-primary" />
            </div>
            <div className="text-center">
              <h1 className="text-lg font-semibold tracking-tight">VPS Pilot</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Server not configured</p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground text-center">
            No admin account exists yet. Run the setup wizard on the server to create one:
          </p>

          <div className="rounded-md bg-secondary/60 border border-border p-3 font-mono text-xs space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Terminal className="size-3.5 shrink-0" />
              <span className="text-foreground">sudo vps-pilot install</span>
            </div>
            <p className="text-muted-foreground pl-5">or, on an existing install:</p>
            <div className="flex items-center gap-2 text-muted-foreground pl-5">
              <span className="text-foreground">vps-pilot adduser &lt;username&gt;</span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground/60 text-center">
            After creating the admin account, refresh this page.
          </p>
        </div>
      </div>
    </div>
  );
}
