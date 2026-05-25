import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Download, ExternalLink, Info, AlertTriangle } from "lucide-react";
import { getVersion, checkUpdate, applyUpdate, getConfig, updateConfig } from "@/api/system";
import type { ServerConfig, ServerConfigUpdate } from "@/api/system";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/api/client";

// ─── Settings Page ────────────────────────────────────────────────────────────

export function Settings() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">System configuration and updates</p>
      </div>
      <UpdateSection />
      <ConfigSection />
    </div>
  );
}

// ─── Update Section ───────────────────────────────────────────────────────────

function UpdateSection() {
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<Awaited<ReturnType<typeof checkUpdate>> | null>(null);
  const [applying, setApplying] = useState(false);

  const { data: version } = useQuery({ queryKey: ["version"], queryFn: getVersion });

  async function handleCheck() {
    setChecking(true);
    try {
      const result = await checkUpdate();
      setUpdateInfo(result);
      if (!result.hasUpdate) {
        toast.success("You're up to date!");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to check for updates");
    } finally {
      setChecking(false);
    }
  }

  async function handleApply() {
    setApplying(true);
    try {
      await applyUpdate();
      toast.success("Update applied — server is restarting…");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to apply update");
      setApplying(false);
    }
  }

  return (
    <section className="rounded-lg border border-border p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-medium">Application Version</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Check for and apply updates to vps-pilot
          </p>
        </div>
        {version && (
          <span className="text-xs font-mono bg-secondary px-2 py-1 rounded">
            {version.version}
          </span>
        )}
      </div>

      {updateInfo && (
        <div
          className={`rounded-md p-3 text-sm ${
            updateInfo.hasUpdate
              ? "bg-yellow-500/10 border border-yellow-500/30 text-yellow-700 dark:text-yellow-400"
              : "bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400"
          }`}
        >
          {updateInfo.hasUpdate ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0" />
                <span>
                  Update available: <strong>{updateInfo.latestVersion}</strong>{" "}
                  (current: {updateInfo.currentVersion})
                </span>
              </div>
              {updateInfo.releaseURL && (
                <a
                  href={updateInfo.releaseURL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs underline opacity-80 hover:opacity-100"
                >
                  View release notes <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Info className="size-4 shrink-0" />
              <span>You're running the latest version ({updateInfo.currentVersion}).</span>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleCheck} disabled={checking}>
          <RefreshCw className={`size-4 mr-1.5 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Checking…" : "Check for updates"}
        </Button>
        {updateInfo?.hasUpdate && (
          <Button size="sm" onClick={handleApply} disabled={applying}>
            <Download className="size-4 mr-1.5" />
            {applying ? "Applying…" : "Apply update"}
          </Button>
        )}
      </div>
    </section>
  );
}

// ─── Config Section ───────────────────────────────────────────────────────────

function ConfigSection() {
  const qc = useQueryClient();
  const { data: cfg, isLoading, error } = useQuery({
    queryKey: ["server-config"],
    queryFn: getConfig,
    retry: (_, err) => !(err instanceof ApiError && err.status === 404),
  });

  const [draft, setDraft] = useState<ServerConfigUpdate>({});
  const [restartFields, setRestartFields] = useState<string[]>([]);

  const save = useMutation({
    mutationFn: () => updateConfig(draft),
    onSuccess: (res: { requiresRestart: boolean; restartFields: string[] }) => {
      if (res.requiresRestart && res.restartFields?.length > 0) {
        setRestartFields(res.restartFields);
        toast.warning(`Saved — restart required for: ${res.restartFields.join(", ")}`);
      } else {
        setRestartFields([]);
        toast.success("Configuration applied.");
      }
      setDraft({});
      qc.invalidateQueries({ queryKey: ["server-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  if (isLoading) {
    return (
      <section className="rounded-lg border border-border p-5">
        <p className="text-sm text-muted-foreground">Loading configuration…</p>
      </section>
    );
  }

  if (error) {
    const is404 = error instanceof ApiError && error.status === 404;
    return (
      <section className="rounded-lg border border-border p-5 space-y-2">
        <h2 className="font-medium">Configuration File</h2>
        <p className="text-sm text-muted-foreground">
          {is404
            ? "The server was started without a config file (environment variables or defaults). Create a config file to enable editing."
            : "Failed to load configuration."}
        </p>
      </section>
    );
  }

  if (!cfg) return null;

  function field(key: keyof ServerConfigUpdate) {
    const value = key in draft ? (draft[key] as string) : (cfg![key as keyof ServerConfig] as string);
    return {
      value: value ?? "",
      onChange: (v: string) => {
        setDraft((d) => ({ ...d, [key]: v }));
      },
    };
  }

  const hasChanges = Object.keys(draft).length > 0;

  return (
    <section className="rounded-lg border border-border p-5 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-medium">Configuration File</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Edit the server configuration. Most changes apply immediately; fields marked "requires restart" need a service restart.
          </p>
        </div>
        {cfg.configPath && (
          <span className="text-xs text-muted-foreground font-mono">{cfg.configPath}</span>
        )}
      </div>

      {restartFields.length > 0 && (
        <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 p-3 text-sm text-yellow-700 dark:text-yellow-400">
          <AlertTriangle className="inline size-4 mr-1.5" />
          Restart the server to apply: <span className="font-mono">{restartFields.join(", ")}</span>
          <code className="block mt-1 text-xs opacity-70">sudo systemctl restart vps-pilot</code>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <ConfigField label="Listen Address" description="Host:port the server binds to" requiresRestart {...field("listenAddr")} />
        <SelectField
          label="Auth Mode"
          description="Authentication backend"
          options={["both", "local", "pam"]}
          {...field("authMode")}
        />
        <ConfigField label="Projects Directory" description="Root path for Docker Compose projects" {...field("projectsDir")} />
        <ConfigField label="Files Root" description="Root path for the file browser" {...field("filesRoot")} />
        <ConfigField label="TLS Certificate" description="Path to TLS cert (leave empty for plain HTTP)" requiresRestart {...field("tlsCert")} />
        <ConfigField label="TLS Key" description="Path to TLS private key" requiresRestart {...field("tlsKey")} />
        <SelectField
          label="Log Sink"
          description="Where to write application logs"
          options={["both", "stdout", "db"]}
          {...field("logSink")}
        />
        <SelectField
          label="Log Level"
          description="Minimum log level to emit"
          options={["info", "debug", "warn", "error"]}
          {...field("logLevel")}
        />
        <ConfigField label="Metrics Interval" description="How often metrics are recorded (e.g. 30s, 1m)" {...field("metricsInterval")} />
        <ConfigField label="Metrics Retention" description="How long metrics are kept (e.g. 168h = 7 days)" {...field("metricsRetention")} />
      </div>

      <div className="rounded-md bg-secondary/40 p-3 space-y-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Read-only fields</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Data Dir: </span>
            <span className="font-mono text-xs">{cfg.dataDir}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Cookie Secret: </span>
            <span className="font-mono text-xs text-muted-foreground">••••••••••••••••</span>
            <span className="text-xs text-muted-foreground ml-1">(change via config file directly)</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={!hasChanges || save.isPending}>
          {save.isPending ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </section>
  );
}

function ConfigField({
  label,
  description,
  value,
  onChange,
  requiresRestart,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  requiresRestart?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
        {requiresRestart && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30">
            requires restart
          </span>
        )}
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 font-mono"
      />
    </div>
  );
}

function SelectField({
  label,
  description,
  options,
  value,
  onChange,
}: {
  label: string;
  description: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}
