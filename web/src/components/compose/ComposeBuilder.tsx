import { listRegistries, searchImageTags, type Registry } from "@/api/registries";
import {
  Tooltip,
  TooltipContent, TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AlertTriangle, ChevronDown, ChevronRight, GripVertical, HelpCircle, Loader2, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ComposeFile, ComposeService,
  DependsOnEntry, HealthCheck,
  PortSpec,
  ResourceLimits,
  VolumeMount,
} from "./types";

// ─── Help Tooltip ─────────────────────────────────────────────────────────────

function Help({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex cursor-help" />}>
          <HelpCircle className="size-3 text-muted-foreground/50 hover:text-muted-foreground transition-colors" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-snug">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function SectionHeader({ label, open, onToggle, count }: {
  label: string; open: boolean; onToggle: () => void; count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
    >
      <span>{label}{count != null ? ` (${count})` : ""}</span>
      {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
    </button>
  );
}

function FieldLabel({ label, help }: { label: string; help?: string }) {
  return (
    <label className="text-xs text-muted-foreground w-28 shrink-0 flex items-center gap-1">
      {label}
      {help && <Help text={help} />}
    </label>
  );
}

function InputRow({ label, value, onChange, placeholder, mono = false, help }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; mono?: boolean; help?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <FieldLabel label={label} help={help} />
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "flex-1 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary/50",
          mono && "font-mono"
        )}
      />
    </div>
  );
}

function TextareaRow({ label, value, onChange, placeholder, help }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; help?: string;
}) {
  return (
    <div className="flex gap-2">
      <FieldLabel label={label} help={help} />
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50 resize-none"
      />
    </div>
  );
}

function SelectRow({ label, value, onChange, options, help }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; help?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <FieldLabel label={label} help={help} />
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function ToggleRow({ label, value, onChange, help }: {
  label: string; value: boolean | undefined; onChange: (v: boolean) => void; help?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <FieldLabel label={label} help={help} />
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={value ?? false}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded border-border"
        />
        <span className="text-xs text-muted-foreground">{value ? "Yes" : "No"}</span>
      </label>
    </div>
  );
}

// ─── Image Field with registry prefix chip + tag autocomplete ─────────────────

/** Detects if the image string has a registry host prefix (e.g. ghcr.io/, localhost:5000/). */
function parseImageRef(value: string): { prefix: string; rest: string } {
  const slash = value.indexOf("/");
  if (slash > 0) {
    const first = value.slice(0, slash);
    if (first.includes(".") || first.includes(":") || first === "localhost") {
      return { prefix: first + "/", rest: value.slice(slash + 1) };
    }
  }
  return { prefix: "", rest: value };
}

function ImageField({
  value,
  onChange,
  registries = [],
}: {
  value: string;
  onChange: (v: string) => void;
  registries?: Registry[];
}) {
  const parsed = parseImageRef(value);

  // Split rest into imageName + tagPart
  const colonIdx = parsed.rest.indexOf(":");
  const imageName = colonIdx >= 0 ? parsed.rest.slice(0, colonIdx) : parsed.rest;

  const [tags, setTags] = useState<string[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Find matching configured registry for the prefix
  const matchedRegistry = parsed.prefix
    ? registries.find((r) => {
        const host = r.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
        return host === parsed.prefix.replace(/\/$/, "");
      })
    : undefined;

  // Fetch tags with debounce when the user has typed a colon
  const fetchTags = useCallback(
    (image: string, q: string) => {
      setTagsLoading(true);
      searchImageTags(image, q || undefined, matchedRegistry?.id)
        .then((result) => {
          setTags(result);
          setTagsOpen(result.length > 0);
          setSelectedIdx(-1);
        })
        .catch(() => {
          setTags([]);
          setTagsOpen(false);
        })
        .finally(() => setTagsLoading(false));
    },
    [matchedRegistry?.id]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTagsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleRestChange(newRest: string) {
    onChange(parsed.prefix + newRest);
    const ci = newRest.indexOf(":");
    if (ci >= 0) {
      const img = newRest.slice(0, ci);
      const q = newRest.slice(ci + 1);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchTags(parsed.prefix + img, q);
      }, 300);
    } else {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setTagsOpen(false);
      setTags([]);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (tagsOpen && tags.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, tags.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, -1));
        return;
      }
      if (e.key === "Enter" && selectedIdx >= 0) {
        e.preventDefault();
        selectTag(tags[selectedIdx]);
        return;
      }
      if (e.key === "Escape") {
        setTagsOpen(false);
        setSelectedIdx(-1);
        return;
      }
    }
    // Backspace on empty rest → remove registry prefix
    if (e.key === "Backspace" && parsed.rest === "") {
      e.preventDefault();
      onChange("");
    }
  }

  function selectTag(tag: string) {
    onChange(parsed.prefix + imageName + ":" + tag);
    setTagsOpen(false);
    setSelectedIdx(-1);
    inputRef.current?.focus();
  }

  const showLatestWarning =
    value.trim() !== "" &&
    (value.endsWith(":latest") || (!value.includes(":") && value.trim() !== ""));
  const tagMissing = value.trim() !== "" && !value.includes(":");

  return (
    <div className="flex gap-2">
      <FieldLabel
        label="Image"
        help="Docker image to use. Can be from Docker Hub or a private registry configured in the app. Specify a version tag for reproducible deployments."
      />
      <div className="flex-1 space-y-1">
        {/* Input row with optional registry prefix chip */}
        <div className="relative" ref={dropdownRef}>
          <div className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 focus-within:border-primary/50">
            {parsed.prefix && (
              <span className="shrink-0 rounded bg-secondary px-1 text-[10px] font-mono text-muted-foreground select-none">
                {parsed.prefix}
              </span>
            )}
            <input
              ref={inputRef}
              value={parsed.rest}
              onChange={(e) => handleRestChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={parsed.prefix ? "image:tag" : "nginx:1.25.3"}
              className="flex-1 min-w-0 bg-transparent text-xs font-mono outline-none"
            />
            {tagsLoading && (
              <Loader2 className="size-3 text-muted-foreground animate-spin shrink-0" />
            )}
          </div>
          {/* Tags dropdown */}
          {tagsOpen && tags.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-border bg-popover shadow-md overflow-hidden">
              <div className="max-h-48 overflow-y-auto">
                {tags.map((tag, i) => (
                  <button
                    key={tag}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); selectTag(tag); }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-xs font-mono transition-colors",
                      i === selectedIdx
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-secondary/50 text-foreground"
                    )}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {(showLatestWarning || tagMissing) && (
          <div className="flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
            <AlertTriangle className="size-3 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-snug">
              {tagMissing
                ? "No version tag specified. Without a tag Docker defaults to :latest, which can change without notice and makes deployments hard to reproduce. Add a specific tag like :1.25.3."
                : "Using :latest is not recommended in production. The latest tag can change between pulls causing unexpected behavior. Pin to a specific version instead."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Ports Section ────────────────────────────────────────────────────────────

const IP_PRESETS = ["0.0.0.0", "127.0.0.1"];

function PortsSection({ ports, expose, onPorts, onExpose }: {
  ports: PortSpec[];
  expose: string[];
  onPorts: (p: PortSpec[]) => void;
  onExpose: (e: string[]) => void;
}) {
  const [open, setOpen] = useState(ports.length > 0 || expose.length > 0);
  const total = ports.length + expose.length;

  const updatePort = (i: number, field: keyof PortSpec, val: string) =>
    onPorts(ports.map((p, idx) => idx === i ? { ...p, [field]: val || undefined } : p));
  const removePort = (i: number) => onPorts(ports.filter((_, idx) => idx !== i));
  const addPort = () => onPorts([...ports, { container: "8080", host: "8080", ip: "0.0.0.0" }]);

  const removeExpose = (i: number) => onExpose(expose.filter((_, idx) => idx !== i));
  const addExpose = () => onExpose([...expose, "3000"]);
  const updateExpose = (i: number, val: string) =>
    onExpose(expose.map((p, idx) => idx === i ? val : p));

  return (
    <div className="border-t border-border/30 pt-2">
      <SectionHeader label="Ports" count={total} open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <div className="space-y-3 mb-2">
          {/* Published ports */}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Published <Help text="Published ports are accessible from the host machine. Maps host:container port using the 'ports:' key in Compose." />
            </p>
            <div className="space-y-1.5">
              {ports.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <select
                    value={p.ip ?? "0.0.0.0"}
                    onChange={(e) => updatePort(i, "ip", e.target.value)}
                    className="w-28 rounded border border-border bg-background px-1 py-1 text-xs font-mono outline-none"
                  >
                    {IP_PRESETS.map((ip) => <option key={ip} value={ip}>{ip}</option>)}
                    {p.ip && !IP_PRESETS.includes(p.ip) && <option value={p.ip}>{p.ip}</option>}
                  </select>
                  <input
                    value={p.host ?? ""}
                    onChange={(e) => updatePort(i, "host", e.target.value)}
                    placeholder="host"
                    className="w-16 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50"
                  />
                  <span className="text-muted-foreground text-xs">:</span>
                  <input
                    value={p.container}
                    onChange={(e) => updatePort(i, "container", e.target.value)}
                    placeholder="container"
                    className="w-16 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50"
                  />
                  <select
                    value={p.protocol ?? "tcp"}
                    onChange={(e) => updatePort(i, "protocol", e.target.value)}
                    className="w-14 rounded border border-border bg-background px-1 py-1 text-xs outline-none"
                  >
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                  </select>
                  <button type="button" title="Remove port" onClick={() => removePort(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addPort} className="flex items-center gap-1 text-xs text-primary hover:underline">
                <Plus className="size-3" /> Add published port
              </button>
            </div>
          </div>

          {/* Exposed (internal) ports */}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Exposed (internal only) <Help text="Exposed ports are only accessible within the Docker network, not from the host. Uses the 'expose:' key in Compose. Useful for inter-service communication." />
            </p>
            <div className="space-y-1.5">
              {expose.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    value={p}
                    onChange={(e) => updateExpose(i, e.target.value)}
                    placeholder="3000"
                    className="w-24 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50"
                  />
                  <span className="text-[10px] text-muted-foreground">container port</span>
                  <button type="button" title="Remove exposed port" onClick={() => removeExpose(i)} className="text-muted-foreground hover:text-destructive transition-colors ml-auto">
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addExpose} className="flex items-center gap-1 text-xs text-primary hover:underline">
                <Plus className="size-3" /> Add exposed port
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Environment Section ──────────────────────────────────────────────────────

function EnvSection({ env, onChange, projectEnvVars }: { env: Record<string, string>; onChange: (e: Record<string, string>) => void; projectEnvVars?: Record<string, string> }) {
  const [open, setOpen] = useState(Object.keys(env).length > 0);
  const [pickingRow, setPickingRow] = useState<number | null>(null);
  const entries = Object.entries(env);

  const update = (oldKey: string, field: "key" | "value", val: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of entries) {
      if (k === oldKey) {
        if (field === "key") next[val] = v;
        else next[k] = val;
      } else {
        next[k] = v;
      }
    }
    onChange(next);
  };
  const remove = (key: string) => {
    const next = { ...env };
    delete next[key];
    onChange(next);
  };
  const add = () => onChange({ ...env, "": "" });

  return (
    <div className="border-t border-border/30 pt-2">
      <SectionHeader label="Environment" count={entries.length} open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <div className="space-y-1.5 mb-2">
          {entries.map(([k, v], i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={k}
                onChange={(e) => update(k, "key", e.target.value)}
                placeholder="KEY"
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50"
              />
              <span className="text-muted-foreground text-xs">=</span>
              {pickingRow === i ? (
                <select
                  autoFocus
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      update(k, "value", `\${${e.target.value}}`);
                    }
                    setPickingRow(null);
                  }}
                  onBlur={() => setPickingRow(null)}
                >
                  <option value="">— pick a variable —</option>
                  {Object.keys(projectEnvVars ?? {}).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={v}
                  onChange={(e) => update(k, "value", e.target.value)}
                  placeholder="value"
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50"
                />
              )}
              {projectEnvVars && Object.keys(projectEnvVars).length > 0 && pickingRow !== i && (
                <button
                  type="button"
                  title="Pick project variable"
                  onClick={() => setPickingRow(i)}
                  className="text-muted-foreground hover:text-primary transition-colors text-xs px-1 flex-shrink-0"
                >
                  <span className="text-xs font-semibold">${"{}"}</span>
                </button>
              )}
              <button type="button" title="Remove" onClick={() => remove(k)} className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"><X className="size-3.5" /></button>
            </div>
          ))}
          <button type="button" onClick={add} className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus className="size-3" /> Add variable
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Volumes Section ──────────────────────────────────────────────────────────

function VolumesSection({ volumes, onChange }: { volumes: VolumeMount[]; onChange: (v: VolumeMount[]) => void }) {
  const [open, setOpen] = useState(volumes.length > 0);

  const update = (i: number, field: keyof VolumeMount, val: string | boolean) =>
    onChange(volumes.map((v, idx) => idx === i ? { ...v, [field]: val } : v));
  const remove = (i: number) => onChange(volumes.filter((_, idx) => idx !== i));
  const add = () => onChange([...volumes, { source: "", target: "/data" }]);

  return (
    <div className="border-t border-border/30 pt-2">
      <SectionHeader label="Volumes" count={volumes.length} open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <div className="space-y-1.5 mb-2">
          {volumes.map((v, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={v.source}
                onChange={(e) => update(i, "source", e.target.value)}
                placeholder="source (volume or path)"
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50"
              />
              <span className="text-muted-foreground text-xs">:</span>
              <input
                value={v.target}
                onChange={(e) => update(i, "target", e.target.value)}
                placeholder="/container/path"
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50"
              />
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={v.readOnly ?? false}
                  onChange={(e) => update(i, "readOnly", e.target.checked)}
                />
                ro
              </label>
              <button type="button" title="Remove" onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive transition-colors"><X className="size-3.5" /></button>
            </div>
          ))}
          <button type="button" onClick={add} className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus className="size-3" /> Add volume
          </button>
        </div>
      )}
    </div>
  );
}

// ─── HealthCheck Section ──────────────────────────────────────────────────────

function HealthCheckSection({ hc, onChange }: { hc: HealthCheck | undefined; onChange: (h: HealthCheck | undefined) => void }) {
  const [open, setOpen] = useState(!!hc && !hc.disable);
  const current = hc ?? {};

  if (!open && !hc) {
    return (
      <div className="border-t border-border/30 pt-2">
        <SectionHeader label="Healthcheck" open={false} onToggle={() => { setOpen(true); onChange({ test: "" }); }} />
      </div>
    );
  }

  return (
    <div className="border-t border-border/30 pt-2">
      <SectionHeader label="Healthcheck" open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <div className="space-y-1.5 mb-2">
          <InputRow
            label="Test command"
            value={current.test ?? ""}
            onChange={(v) => onChange({ ...current, test: v })}
            placeholder="curl -f http://localhost/ || exit 1"
            mono
            help="Shell command to run inside the container to check its health. Should exit 0 on success, non-zero on failure."
          />
          <InputRow label="Interval" value={current.interval ?? ""} onChange={(v) => onChange({ ...current, interval: v })} placeholder="30s" help="How often to run the health check (e.g. 30s, 1m)." />
          <InputRow label="Timeout" value={current.timeout ?? ""} onChange={(v) => onChange({ ...current, timeout: v })} placeholder="10s" help="Max time for a single health check to complete before it's considered failed." />
          <div className="flex items-center gap-2">
            <FieldLabel label="Retries" help="Number of consecutive failures before the container is marked unhealthy." />
            <input
              type="number"
              value={current.retries ?? ""}
              onChange={(e) => onChange({ ...current, retries: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="3"
              className="w-20 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary/50"
            />
          </div>
          <InputRow label="Start period" value={current.startPeriod ?? ""} onChange={(v) => onChange({ ...current, startPeriod: v })} placeholder="10s" help="Initialization time for the container before health check failures count. Useful for slow-starting apps." />
          <button
            type="button"
            onClick={() => { setOpen(false); onChange(undefined); }}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            Remove healthcheck
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Resource Limits Section ──────────────────────────────────────────────────

function ResourcesSection({ limits, onChange }: { limits: ResourceLimits | undefined; onChange: (l: ResourceLimits | undefined) => void }) {
  const [open, setOpen] = useState(!!limits);
  const current = limits ?? {};

  return (
    <div className="border-t border-border/30 pt-2">
      <SectionHeader label="Resource limits" open={open} onToggle={() => { setOpen((v) => !v); if (!limits) onChange({}); }} />
      {open && (
        <div className="space-y-1.5 mb-2">
          <InputRow
            label="CPUs"
            value={current.cpus ?? ""}
            onChange={(v) => onChange({ ...current, cpus: v || undefined })}
            placeholder="0.5"
            help="Maximum number of CPU cores the container can use. Decimal fractions allowed (0.5 = half a core)."
          />
          <InputRow
            label="Memory"
            value={current.memory ?? ""}
            onChange={(v) => onChange({ ...current, memory: v || undefined })}
            placeholder="512m"
            help="Maximum memory. Use m for megabytes, g for gigabytes (e.g. 512m, 2g)."
          />
          <button
            type="button"
            onClick={() => { setOpen(false); onChange(undefined); }}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            Remove limits
          </button>
        </div>
      )}
    </div>
  );
}

// ─── DependsOn Section ───────────────────────────────────────────────────────

function DependsOnSection({ deps, allServices, onChange }: {
  deps: DependsOnEntry[];
  allServices: string[];
  onChange: (d: DependsOnEntry[]) => void;
}) {
  const [open, setOpen] = useState(deps.length > 0);
  const available = allServices.filter((s) => !deps.find((d) => d.service === s));

  return (
    <div className="border-t border-border/30 pt-2">
      <SectionHeader label="Depends on" count={deps.length} open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <div className="space-y-1.5 mb-2">
          {deps.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-xs font-mono text-muted-foreground flex-1">{d.service}</span>
              <select
                value={d.condition ?? "service_started"}
                onChange={(e) => onChange(deps.map((dep, idx) => idx === i ? { ...dep, condition: e.target.value as DependsOnEntry["condition"] } : dep))}
                className="flex-1 rounded border border-border bg-background px-1 py-1 text-xs outline-none"
              >
                <option value="service_started">started</option>
                <option value="service_healthy">healthy</option>
                <option value="service_completed_successfully">completed</option>
              </select>
              <button type="button" title="Remove dependency" onClick={() => onChange(deps.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive transition-colors"><X className="size-3.5" /></button>
            </div>
          ))}
          {available.length > 0 && (
            <select
              value=""
              onChange={(e) => { if (e.target.value) onChange([...deps, { service: e.target.value, condition: "service_started" }]); }}
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none"
            >
              <option value="">+ Add dependency…</option>
              {available.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

// ─── KV Section ───────────────────────────────────────────────────────────────

function KVSection({ label: sectionLabel, data, onChange, keyPlaceholder = "key", valuePlaceholder = "value" }: {
  label: string;
  data: Record<string, string>;
  onChange: (d: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const [open, setOpen] = useState(Object.keys(data).length > 0);
  const entries = Object.entries(data);

  const update = (oldKey: string, field: "key" | "value", val: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of entries) {
      if (k === oldKey) field === "key" ? (next[val] = v) : (next[k] = val);
      else next[k] = v;
    }
    onChange(next);
  };

  return (
    <div className="border-t border-border/30 pt-2">
      <SectionHeader label={sectionLabel} count={entries.length} open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <div className="space-y-1.5 mb-2">
          {entries.map(([k, v], i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input value={k} onChange={(e) => update(k, "key", e.target.value)} placeholder={keyPlaceholder}
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50" />
              <span className="text-muted-foreground text-xs">=</span>
              <input value={v} onChange={(e) => update(k, "value", e.target.value)} placeholder={valuePlaceholder}
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50" />
              <button type="button" title="Remove" onClick={() => { const n = { ...data }; delete n[k]; onChange(n); }}
                className="text-muted-foreground hover:text-destructive transition-colors"><X className="size-3.5" /></button>
            </div>
          ))}
          <button type="button" onClick={() => onChange({ ...data, "": "" })}
            className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus className="size-3" /> Add
          </button>
        </div>
      )}
    </div>
  );
}

// ─── String List Section ──────────────────────────────────────────────────────

function StrListSection({ label, items, onChange, placeholder, help }: {
  label: string;
  items: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  help?: string;
}) {
  const [open, setOpen] = useState(items.length > 0);

  return (
    <div className="border-t border-border/30 pt-2">
      <div className="flex items-center gap-1">
        <SectionHeader label={label} count={items.length} open={open} onToggle={() => setOpen((v) => !v)} />
        {help && <Help text={help} />}
      </div>
      {open && (
        <div className="space-y-1.5 mb-2">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={item}
                onChange={(e) => onChange(items.map((v, idx) => idx === i ? e.target.value : v))}
                placeholder={placeholder}
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50"
              />
              <button type="button" title="Remove" onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                className="text-muted-foreground hover:text-destructive transition-colors"><X className="size-3.5" /></button>
            </div>
          ))}
          <button type="button" onClick={() => onChange([...items, ""])}
            className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus className="size-3" /> Add
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Service Card ─────────────────────────────────────────────────────────────

function ServiceCard({ name, svc, allServices, onChange, onRename, onRemove, registries, projectEnvVars }: {
  name: string;
  svc: ComposeService;
  allServices: string[];
  onChange: (svc: ComposeService) => void;
  onRename: (newName: string) => void;
  onRemove: () => void;
  registries?: Registry[];
  projectEnvVars?: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(name);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const set = <K extends keyof ComposeService>(key: K, val: ComposeService[K]) =>
    onChange({ ...svc, [key]: val });

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Service header */}
      <div className="flex items-center gap-2 px-3 py-2  border-border">
        <GripVertical className="size-3.5 text-muted-foreground/40" />
        <button
          type="button"
          title={expanded ? "Collapse" : "Expand"}
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        {editingName ? (
          <input
            autoFocus
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onBlur={() => { if (nameVal.trim() && nameVal !== name) onRename(nameVal.trim()); setEditingName(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { if (nameVal.trim() && nameVal !== name) onRename(nameVal.trim()); setEditingName(false); }
              if (e.key === "Escape") { setNameVal(name); setEditingName(false); }
            }}
            className="flex-1 rounded border border-primary bg-background px-2 py-0.5 text-xs font-mono outline-none"
          />
        ) : (
          <button type="button" onClick={() => setEditingName(true)} className="flex-1 text-left text-xs font-mono font-medium hover:text-primary transition-colors">
            {name}
          </button>
        )}
        {svc.image && <span className="text-xs text-muted-foreground font-mono truncate max-w-50">{svc.image}</span>}
        <button type="button" title="Remove service" onClick={onRemove} className="text-muted-foreground hover:text-destructive transition-colors ml-auto">
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="p-3 space-y-2">
          {/* Basic */}
          <div className="space-y-1.5">
            <ImageField value={svc.image ?? ""} onChange={(v) => set("image", v || undefined)} registries={registries} />
            <InputRow
              label="Container name"
              value={svc.container_name ?? ""}
              onChange={(v) => set("container_name", v || undefined)}
              placeholder="(auto)"
              help="Custom name for the container. If omitted, Docker Compose generates one from the project and service name."
            />
            <InputRow
              label="Hostname"
              value={svc.hostname ?? ""}
              onChange={(v) => set("hostname", v || undefined)}
              placeholder="(auto)"
              help="Hostname for the container inside the Docker network. Other services can reach it by this name."
            />
            <SelectRow
              label="Restart"
              value={svc.restart ?? "no"}
              onChange={(v) => set("restart", (v || "no") as ComposeService["restart"])}
              options={[
                { value: "no", label: "no — never restart" },
                { value: "always", label: "always — restart always" },
                { value: "on-failure", label: "on-failure — restart on error exit" },
                { value: "unless-stopped", label: "unless-stopped — always except manual stop" },
              ]}
              help="When to automatically restart the container. 'unless-stopped' is recommended for long-running services."
            />
            <TextareaRow
              label="Command"
              value={svc.command ?? ""}
              onChange={(v) => set("command", v || undefined)}
              placeholder="(default from image)"
              help="Override the default command defined in the Docker image. This replaces CMD in the Dockerfile."
            />
            <TextareaRow
              label="Entrypoint"
              value={svc.entrypoint ?? ""}
              onChange={(v) => set("entrypoint", v || undefined)}
              placeholder="(default from image)"
              help="Override the entrypoint defined in the Docker image. This replaces ENTRYPOINT in the Dockerfile. Use with care."
            />
            <InputRow
              label="User"
              value={svc.user ?? ""}
              onChange={(v) => set("user", v || undefined)}
              placeholder="1000:1000"
              help="Run the container process as this user (and optional group). Accepts user, user:group, uid, or uid:gid."
            />
            <InputRow
              label="Working dir"
              value={svc.working_dir ?? ""}
              onChange={(v) => set("working_dir", v || undefined)}
              placeholder="/app"
              help="Set the working directory inside the container for the command/entrypoint."
            />
          </div>

          {/* Sections */}
          <PortsSection
            ports={svc.ports ?? []}
            expose={svc.expose ?? []}
            onPorts={(p) => set("ports", p.length ? p : undefined)}
            onExpose={(e) => set("expose", e.length ? e : undefined)}
          />
          <EnvSection env={svc.environment ?? {}} onChange={(e) => set("environment", Object.keys(e).length ? e : undefined)} projectEnvVars={projectEnvVars} />
          <VolumesSection volumes={svc.volumes ?? []} onChange={(v) => set("volumes", v.length ? v : undefined)} />
          <DependsOnSection
            deps={svc.depends_on ?? []}
            allServices={allServices.filter((s) => s !== name)}
            onChange={(d) => set("depends_on", d.length ? d : undefined)}
          />
          <HealthCheckSection hc={svc.healthcheck} onChange={(h) => set("healthcheck", h)} />
          <ResourcesSection
            limits={svc.deploy?.resources?.limits}
            onChange={(l) => set("deploy", l ? { resources: { limits: l } } : undefined)}
          />
          <KVSection label="Labels" data={svc.labels ?? {}} onChange={(d) => set("labels", Object.keys(d).length ? d : undefined)} />

          {/* Advanced toggle */}
          <div className="border-t border-border/30 pt-2">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="w-full flex items-center justify-between py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="font-semibold uppercase tracking-wider">Advanced</span>
              {showAdvanced ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
          </div>

          {showAdvanced && (
            <div className="space-y-2">
              {/* Runtime toggles */}
              <div className="space-y-1.5">
                <ToggleRow label="Privileged" value={svc.privileged} onChange={(v) => set("privileged", v || undefined)} help="Give extended privileges to the container. Allows access to all host devices. Use only when absolutely necessary." />
                <ToggleRow label="Read-only FS" value={svc.read_only} onChange={(v) => set("read_only", v || undefined)} help="Mount the container root filesystem as read-only. Services needing writes must use explicit volumes." />
                <ToggleRow label="Init process" value={svc.init} onChange={(v) => set("init", v || undefined)} help="Run an init process (tini) inside the container to properly forward signals and reap zombie processes." />
                <ToggleRow label="TTY" value={svc.tty} onChange={(v) => set("tty", v || undefined)} help="Allocate a pseudo-TTY. Equivalent to -t flag in docker run." />
                <ToggleRow label="stdin_open" value={svc.stdin_open} onChange={(v) => set("stdin_open", v || undefined)} help="Keep stdin open. Equivalent to -i flag in docker run. Needed for interactive processes." />
              </div>

              {/* Lifecycle */}
              <SelectRow
                label="Stop signal"
                value={svc.stop_signal ?? "SIGTERM"}
                onChange={(v) => set("stop_signal", v === "SIGTERM" ? undefined : v)}
                options={[
                  { value: "SIGTERM", label: "SIGTERM (default)" },
                  { value: "SIGKILL", label: "SIGKILL" },
                  { value: "SIGUSR1", label: "SIGUSR1" },
                  { value: "SIGUSR2", label: "SIGUSR2" },
                  { value: "SIGHUP", label: "SIGHUP" },
                ]}
                help="Signal sent to gracefully stop the container. SIGTERM is the default. Use SIGUSR1/2 for apps that handle custom signals."
              />
              <InputRow
                label="Stop timeout"
                value={svc.stop_grace_period ?? ""}
                onChange={(v) => set("stop_grace_period", v || undefined)}
                placeholder="10s"
                help="Time to wait for the container to stop gracefully before force-killing it (e.g. 30s, 1m)."
              />
              <div className="flex items-center gap-2">
                <FieldLabel label="Scale" help="Number of replicas to run. Requires no port conflicts (don't bind specific host ports)." />
                <input
                  type="number"
                  min={1}
                  value={svc.scale ?? ""}
                  onChange={(e) => set("scale", e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="1"
                  className="w-20 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary/50"
                />
              </div>

              {/* Shared resources */}
              <SelectRow
                label="PID mode"
                value={svc.pid ?? ""}
                onChange={(v) => set("pid", v || undefined)}
                options={[
                  { value: "", label: "(default)" },
                  { value: "host", label: "host — share host PID namespace" },
                ]}
                help="Share the host's PID namespace. Allows the container to see all host processes. Requires elevated privileges."
              />
              <SelectRow
                label="IPC mode"
                value={svc.ipc ?? ""}
                onChange={(v) => set("ipc", v || undefined)}
                options={[
                  { value: "", label: "(default)" },
                  { value: "host", label: "host — share host IPC namespace" },
                  { value: "shareable", label: "shareable — can share with other containers" },
                  { value: "none", label: "none — private, isolated" },
                ]}
                help="Inter-process communication mode. 'host' shares the host's IPC namespace (shared memory, semaphores)."
              />
              <InputRow
                label="Shared memory"
                value={svc.shm_size ?? ""}
                onChange={(v) => set("shm_size", v || undefined)}
                placeholder="64m"
                help="Size of /dev/shm. Some applications (like browsers, PyTorch) need larger shared memory. Use m/g suffix."
              />

              {/* String lists */}
              <StrListSection
                label="Extra hosts"
                items={svc.extra_hosts ?? []}
                onChange={(v) => set("extra_hosts", v.length ? v : undefined)}
                placeholder="hostname:ip"
                help="Add entries to /etc/hosts. Format: hostname:ip (e.g. api.local:192.168.1.10)."
              />
              <StrListSection
                label="cap_add"
                items={svc.cap_add ?? []}
                onChange={(v) => set("cap_add", v.length ? v : undefined)}
                placeholder="NET_ADMIN"
                help="Linux capabilities to add. Common: NET_ADMIN (network config), SYS_ADMIN (system admin), SYS_PTRACE (debugging)."
              />
              <StrListSection
                label="cap_drop"
                items={svc.cap_drop ?? []}
                onChange={(v) => set("cap_drop", v.length ? v : undefined)}
                placeholder="ALL"
                help="Linux capabilities to remove. Use 'ALL' to drop all capabilities and then add back only what's needed."
              />
              <StrListSection
                label="DNS servers"
                items={svc.dns ?? []}
                onChange={(v) => set("dns", v.length ? v : undefined)}
                placeholder="8.8.8.8"
                help="Custom DNS servers for the container. Overrides Docker's default DNS."
              />
              <StrListSection
                label="DNS search"
                items={svc.dns_search ?? []}
                onChange={(v) => set("dns_search", v.length ? v : undefined)}
                placeholder="example.com"
                help="DNS search domains. Short hostnames like 'db' will be tried as 'db.example.com'."
              />
              <StrListSection
                label="Devices"
                items={svc.devices ?? []}
                onChange={(v) => set("devices", v.length ? v : undefined)}
                placeholder="/dev/sda:/dev/xda"
                help="Host devices to expose to the container. Format: host_path:container_path. Requires privileged or specific capabilities."
              />
              <StrListSection
                label="Tmpfs mounts"
                items={svc.tmpfs ?? []}
                onChange={(v) => set("tmpfs", v.length ? v : undefined)}
                placeholder="/tmp"
                help="Mount tmpfs (in-memory) filesystems. Data is lost when the container stops. Useful for /tmp or sensitive data."
              />
              <StrListSection
                label="Security options"
                items={svc.security_opt ?? []}
                onChange={(v) => set("security_opt", v.length ? v : undefined)}
                placeholder="no-new-privileges:true"
                help="Override default security label/seccomp/apparmor options. Use 'no-new-privileges:true' for hardened containers."
              />
              <StrListSection
                label="Profiles"
                items={svc.profiles ?? []}
                onChange={(v) => set("profiles", v.length ? v : undefined)}
                placeholder="production"
                help="Compose profiles this service belongs to. Services with profiles only start when that profile is active."
              />
              <KVSection
                label="Sysctls"
                data={svc.sysctls ?? {}}
                onChange={(d) => set("sysctls", Object.keys(d).length ? d : undefined)}
                keyPlaceholder="net.ipv4.ip_forward"
                valuePlaceholder="1"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ComposeBuilder ──────────────────────────────────────────────────────

interface ComposeBuilderProps {
  value: ComposeFile;
  onChange: (cf: ComposeFile) => void;
  projectEnvVars?: Record<string, string>;
}

export function ComposeBuilder({ value, onChange }: ComposeBuilderProps) {
  const services = value.services ?? {};
  const serviceNames = Object.keys(services);

  // Load registries for ImageField registry-prefix matching and tag auth
  const [registries, setRegistries] = useState<Registry[]>([]);
  useEffect(() => {
    listRegistries().then(setRegistries).catch(() => {});
  }, []);

  function updateService(name: string, svc: ComposeService) {
    onChange({ ...value, services: { ...services, [name]: svc } });
  }

  function renameService(oldName: string, newName: string) {
    if (services[newName]) return; // already exists
    const next: typeof services = {};
    for (const [k, v] of Object.entries(services)) {
      next[k === oldName ? newName : k] = v;
    }
    // Update depends_on references
    for (const [k, svc] of Object.entries(next)) {
      if (svc.depends_on) {
        next[k] = {
          ...svc,
          depends_on: svc.depends_on.map((d) =>
            d.service === oldName ? { ...d, service: newName } : d
          ),
        };
      }
    }
    onChange({ ...value, services: next });
  }

  function removeService(name: string) {
    const next = { ...services };
    delete next[name];
    onChange({ ...value, services: next });
  }

  function addService() {
    let n = "service";
    let i = 1;
    while (services[n]) n = `service${++i}`;
    onChange({ ...value, services: { ...services, [n]: { restart: "unless-stopped" } } });
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto h-full">
      {serviceNames.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-muted-foreground mb-3">No services defined</p>
          <button
            type="button"
            onClick={addService}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Plus className="size-3.5" /> Add service
          </button>
        </div>
      ) : (
        <>
          {serviceNames.map((name) => (
            <ServiceCard
              key={name}
              name={name}
              svc={services[name]}
              allServices={serviceNames}
              onChange={(svc) => updateService(name, svc)}
              onRename={(newName) => renameService(name, newName)}
              onRemove={() => removeService(name)}
              registries={registries}
              projectEnvVars={projectEnvVars}
            />
          ))}
          <button
            type="button"
            onClick={addService}
            className="w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
          >
            <Plus className="size-3.5" /> Add service
          </button>
        </>
      )}
    </div>
  );
}
