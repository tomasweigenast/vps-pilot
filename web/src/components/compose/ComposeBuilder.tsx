import { useState } from "react";
import { Plus, ChevronDown, ChevronRight, Trash2, X, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ComposeFile, ComposeService, PortSpec, VolumeMount, DependsOnEntry, HealthCheck, ResourceLimits,
} from "./types";
import { portSpecToString, parsePortSpec, volumeMountToString, parseVolumeMount } from "./types";

// ─── Small helpers ────────────────────────────────────────────────────────────

function SectionHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
    >
      {label}
      {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
    </button>
  );
}

function InputRow({ label, value, onChange, placeholder, mono = false }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-muted-foreground w-28 shrink-0">{label}</label>
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

function SelectRow({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-muted-foreground w-28 shrink-0">{label}</label>
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

// ─── Ports Section ────────────────────────────────────────────────────────────

function PortsSection({ ports, onChange }: { ports: PortSpec[]; onChange: (p: PortSpec[]) => void }) {
  const [open, setOpen] = useState(ports.length > 0);

  const update = (i: number, field: keyof PortSpec, val: string) =>
    onChange(ports.map((p, idx) => idx === i ? { ...p, [field]: val || undefined } : p));
  const remove = (i: number) => onChange(ports.filter((_, idx) => idx !== i));
  const add = () => onChange([...ports, { container: "8080", host: "" }]);

  return (
    <div className="border-t border-border/30 pt-2">
      <SectionHeader label={`Ports (${ports.length})`} open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <div className="space-y-1.5 mb-2">
          {ports.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={p.host ?? ""}
                onChange={(e) => update(i, "host", e.target.value)}
                placeholder="host port (optional)"
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50"
              />
              <span className="text-muted-foreground text-xs">:</span>
              <input
                value={p.container}
                onChange={(e) => update(i, "container", e.target.value)}
                placeholder="container port"
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50"
              />
              <select
                value={p.protocol ?? "tcp"}
                onChange={(e) => update(i, "protocol", e.target.value)}
                className="w-16 rounded border border-border bg-background px-1 py-1 text-xs outline-none"
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
              <button type="button" onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive transition-colors"><X className="size-3.5" /></button>
            </div>
          ))}
          <button type="button" onClick={add} className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus className="size-3" /> Add port
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Environment Section ──────────────────────────────────────────────────────

function EnvSection({ env, onChange }: { env: Record<string, string>; onChange: (e: Record<string, string>) => void }) {
  const [open, setOpen] = useState(Object.keys(env).length > 0);
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
      <SectionHeader label={`Environment (${entries.length})`} open={open} onToggle={() => setOpen((v) => !v)} />
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
              <input
                value={v}
                onChange={(e) => update(k, "value", e.target.value)}
                placeholder="value"
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50"
              />
              <button type="button" onClick={() => remove(k)} className="text-muted-foreground hover:text-destructive transition-colors"><X className="size-3.5" /></button>
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
      <SectionHeader label={`Volumes (${volumes.length})`} open={open} onToggle={() => setOpen((v) => !v)} />
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
              <button type="button" onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive transition-colors"><X className="size-3.5" /></button>
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
          <InputRow label="Test command" value={current.test ?? ""} onChange={(v) => onChange({ ...current, test: v })} placeholder="curl -f http://localhost/ || exit 1" mono />
          <InputRow label="Interval" value={current.interval ?? ""} onChange={(v) => onChange({ ...current, interval: v })} placeholder="30s" />
          <InputRow label="Timeout" value={current.timeout ?? ""} onChange={(v) => onChange({ ...current, timeout: v })} placeholder="10s" />
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-28">Retries</label>
            <input
              type="number"
              value={current.retries ?? ""}
              onChange={(e) => onChange({ ...current, retries: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="3"
              className="w-20 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary/50"
            />
          </div>
          <InputRow label="Start period" value={current.startPeriod ?? ""} onChange={(v) => onChange({ ...current, startPeriod: v })} placeholder="10s" />
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
          <InputRow label="CPUs" value={current.cpus ?? ""} onChange={(v) => onChange({ ...current, cpus: v || undefined })} placeholder="0.5" />
          <InputRow label="Memory" value={current.memory ?? ""} onChange={(v) => onChange({ ...current, memory: v || undefined })} placeholder="512m" />
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
      <SectionHeader label={`Depends on (${deps.length})`} open={open} onToggle={() => setOpen((v) => !v)} />
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
              <button type="button" onClick={() => onChange(deps.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive transition-colors"><X className="size-3.5" /></button>
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

// ─── Labels Section ───────────────────────────────────────────────────────────

function KVSection({ label: sectionLabel, data, onChange }: {
  label: string;
  data: Record<string, string>;
  onChange: (d: Record<string, string>) => void;
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
      <SectionHeader label={`${sectionLabel} (${entries.length})`} open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <div className="space-y-1.5 mb-2">
          {entries.map(([k, v], i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input value={k} onChange={(e) => update(k, "key", e.target.value)} placeholder="key"
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50" />
              <span className="text-muted-foreground text-xs">=</span>
              <input value={v} onChange={(e) => update(k, "value", e.target.value)} placeholder="value"
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary/50" />
              <button type="button" onClick={() => { const n = { ...data }; delete n[k]; onChange(n); }}
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

// ─── Service Card ─────────────────────────────────────────────────────────────

function ServiceCard({ name, svc, allServices, onChange, onRename, onRemove }: {
  name: string;
  svc: ComposeService;
  allServices: string[];
  onChange: (svc: ComposeService) => void;
  onRename: (newName: string) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(name);

  const set = <K extends keyof ComposeService>(key: K, val: ComposeService[K]) =>
    onChange({ ...svc, [key]: val });

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Service header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <GripVertical className="size-3.5 text-muted-foreground/40" />
        <button type="button" onClick={() => setExpanded((v) => !v)} className="text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        {editingName ? (
          <input
            autoFocus
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onBlur={() => { if (nameVal.trim() && nameVal !== name) onRename(nameVal.trim()); setEditingName(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") { if (nameVal.trim() && nameVal !== name) onRename(nameVal.trim()); setEditingName(false); } if (e.key === "Escape") { setNameVal(name); setEditingName(false); } }}
            className="flex-1 rounded border border-primary bg-background px-2 py-0.5 text-xs font-mono outline-none"
          />
        ) : (
          <button type="button" onClick={() => setEditingName(true)} className="flex-1 text-left text-xs font-mono font-medium hover:text-primary transition-colors">
            {name}
          </button>
        )}
        {svc.image && <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">{svc.image}</span>}
        <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-destructive transition-colors ml-auto">
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="p-3 space-y-2">
          {/* Basic */}
          <div className="space-y-1.5">
            <InputRow label="Image" value={svc.image ?? ""} onChange={(v) => set("image", v || undefined)} placeholder="nginx:latest" mono />
            <InputRow label="Container name" value={svc.container_name ?? ""} onChange={(v) => set("container_name", v || undefined)} placeholder="(auto)" />
            <InputRow label="Hostname" value={svc.hostname ?? ""} onChange={(v) => set("hostname", v || undefined)} placeholder="(auto)" />
            <SelectRow
              label="Restart"
              value={svc.restart ?? "no"}
              onChange={(v) => set("restart", (v || "no") as ComposeService["restart"])}
              options={[
                { value: "no", label: "no" },
                { value: "always", label: "always" },
                { value: "on-failure", label: "on-failure" },
                { value: "unless-stopped", label: "unless-stopped" },
              ]}
            />
            <InputRow label="Command" value={svc.command ?? ""} onChange={(v) => set("command", v || undefined)} placeholder="(default)" mono />
          </div>

          {/* Sections */}
          <PortsSection ports={svc.ports ?? []} onChange={(p) => set("ports", p.length ? p : undefined)} />
          <EnvSection env={svc.environment ?? {}} onChange={(e) => set("environment", Object.keys(e).length ? e : undefined)} />
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
        </div>
      )}
    </div>
  );
}

// ─── Main ComposeBuilder ──────────────────────────────────────────────────────

interface ComposeBuilderProps {
  value: ComposeFile;
  onChange: (cf: ComposeFile) => void;
}

export function ComposeBuilder({ value, onChange }: ComposeBuilderProps) {
  const services = value.services ?? {};
  const serviceNames = Object.keys(services);

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
    onChange({ ...value, services: { ...services, [n]: { image: "", restart: "unless-stopped" } } });
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
