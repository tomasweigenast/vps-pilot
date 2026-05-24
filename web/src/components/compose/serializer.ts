import * as jsyaml from "js-yaml";
import type {
  ComposeFile, ComposeService, PortSpec, VolumeMount, DependsOnEntry,
} from "./types";
import { parsePortSpec, parseVolumeMount, portSpecToString, volumeMountToString } from "./types";

// ─── Parse YAML → ComposeFile ─────────────────────────────────────────────────

export function parseCompose(yamlStr: string): ComposeFile {
  if (!yamlStr.trim()) return { services: {}, networks: {}, volumes: {} };

  let raw: unknown;
  try {
    raw = jsyaml.load(yamlStr);
  } catch {
    return { services: {}, networks: {}, volumes: {} };
  }

  if (!raw || typeof raw !== "object") return { services: {}, networks: {}, volumes: {} };
  const obj = raw as Record<string, unknown>;

  const services: Record<string, ComposeService> = {};
  if (obj.services && typeof obj.services === "object") {
    for (const [name, svcRaw] of Object.entries(obj.services as Record<string, unknown>)) {
      if (!svcRaw || typeof svcRaw !== "object") continue;
      services[name] = parseService(svcRaw as Record<string, unknown>);
    }
  }

  return {
    version: typeof obj.version === "string" ? obj.version : undefined,
    services,
    networks: parseTopLevelMap(obj.networks),
    volumes: parseTopLevelMap(obj.volumes),
  };
}

function parseTopLevelMap(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  return raw as Record<string, unknown>;
}

function parseService(raw: Record<string, unknown>): ComposeService {
  const svc: ComposeService = {};

  if (typeof raw.image === "string") svc.image = raw.image;
  if (typeof raw.container_name === "string") svc.container_name = raw.container_name;
  if (typeof raw.hostname === "string") svc.hostname = raw.hostname;
  if (typeof raw.restart === "string") svc.restart = raw.restart as ComposeService["restart"];
  if (typeof raw.command === "string") svc.command = raw.command;
  if (typeof raw.entrypoint === "string") svc.entrypoint = raw.entrypoint;
  if (typeof raw.user === "string") svc.user = raw.user;
  if (typeof raw.working_dir === "string") svc.working_dir = raw.working_dir;
  if (typeof raw.pid === "string") svc.pid = raw.pid;
  if (raw.privileged === true) svc.privileged = true;
  if (raw.read_only === true) svc.read_only = true;
  if (raw.tty === true) svc.tty = true;
  if (raw.stdin_open === true) svc.stdin_open = true;

  // Ports
  if (Array.isArray(raw.ports)) {
    svc.ports = raw.ports.map((p: unknown) => {
      if (typeof p === "string") return parsePortSpec(p);
      if (typeof p === "number") return { container: String(p) };
      return p as PortSpec;
    });
  }

  // Environment
  if (raw.environment) {
    svc.environment = {};
    if (Array.isArray(raw.environment)) {
      for (const e of raw.environment) {
        if (typeof e === "string") {
          const [k, ...rest] = e.split("=");
          svc.environment[k] = rest.join("=");
        }
      }
    } else if (typeof raw.environment === "object") {
      for (const [k, v] of Object.entries(raw.environment as Record<string, unknown>)) {
        svc.environment[k] = String(v ?? "");
      }
    }
  }

  // Volumes
  if (Array.isArray(raw.volumes)) {
    svc.volumes = raw.volumes.map((v: unknown) => {
      if (typeof v === "string") return parseVolumeMount(v);
      return v as VolumeMount;
    });
  }

  // Networks
  if (raw.networks && typeof raw.networks === "object" && !Array.isArray(raw.networks)) {
    svc.networks = raw.networks as ComposeService["networks"];
  } else if (Array.isArray(raw.networks)) {
    svc.networks = {};
    for (const n of raw.networks) {
      if (typeof n === "string") svc.networks[n] = {};
    }
  }

  // Depends on
  if (raw.depends_on) {
    if (Array.isArray(raw.depends_on)) {
      svc.depends_on = raw.depends_on.map((d: unknown) => ({
        service: String(d),
        condition: "service_started",
      }));
    } else if (typeof raw.depends_on === "object") {
      svc.depends_on = Object.entries(raw.depends_on as Record<string, unknown>).map(([k, v]) => ({
        service: k,
        condition: ((v as Record<string, unknown>)?.condition as DependsOnEntry["condition"]) ?? "service_started",
      }));
    }
  }

  // Healthcheck
  if (raw.healthcheck && typeof raw.healthcheck === "object") {
    const h = raw.healthcheck as Record<string, unknown>;
    svc.healthcheck = {
      test: Array.isArray(h.test) ? h.test.slice(1).join(" ") : (typeof h.test === "string" ? h.test : undefined),
      interval: typeof h.interval === "string" ? h.interval : undefined,
      timeout: typeof h.timeout === "string" ? h.timeout : undefined,
      retries: typeof h.retries === "number" ? h.retries : undefined,
      startPeriod: typeof h.start_period === "string" ? h.start_period : undefined,
      disable: h.disable === true,
    };
  }

  // Deploy resources
  if (raw.deploy && typeof raw.deploy === "object") {
    const d = raw.deploy as Record<string, unknown>;
    if (d.resources && typeof d.resources === "object") {
      const res = d.resources as Record<string, unknown>;
      if (res.limits && typeof res.limits === "object") {
        const lim = res.limits as Record<string, unknown>;
        svc.deploy = {
          resources: {
            limits: {
              cpus: typeof lim.cpus === "string" ? lim.cpus : (typeof lim.cpus === "number" ? String(lim.cpus) : undefined),
              memory: typeof lim.memory === "string" ? lim.memory : undefined,
            },
          },
        };
      }
    }
  }

  // Logging
  if (raw.logging && typeof raw.logging === "object") {
    const l = raw.logging as Record<string, unknown>;
    svc.logging = {
      driver: typeof l.driver === "string" ? l.driver : undefined,
      options: (l.options && typeof l.options === "object") ? l.options as Record<string, string> : undefined,
    };
  }

  // Labels
  if (raw.labels) {
    svc.labels = {};
    if (Array.isArray(raw.labels)) {
      for (const lb of raw.labels) {
        if (typeof lb === "string") {
          const [k, ...rest] = lb.split("=");
          svc.labels[k] = rest.join("=");
        }
      }
    } else if (typeof raw.labels === "object") {
      svc.labels = raw.labels as Record<string, string>;
    }
  }

  // Build
  if (raw.build) {
    if (typeof raw.build === "string") {
      svc.build = { context: raw.build };
    } else if (typeof raw.build === "object") {
      const b = raw.build as Record<string, unknown>;
      svc.build = {
        context: typeof b.context === "string" ? b.context : undefined,
        dockerfile: typeof b.dockerfile === "string" ? b.dockerfile : undefined,
        target: typeof b.target === "string" ? b.target : undefined,
        args: (b.args && typeof b.args === "object") ? b.args as Record<string, string> : undefined,
      };
    }
  }

  // extra_hosts, cap_add, cap_drop, env_file
  if (Array.isArray(raw.extra_hosts)) svc.extra_hosts = raw.extra_hosts.map(String);
  if (Array.isArray(raw.cap_add)) svc.cap_add = raw.cap_add.map(String);
  if (Array.isArray(raw.cap_drop)) svc.cap_drop = raw.cap_drop.map(String);
  if (Array.isArray(raw.env_file)) svc.env_file = raw.env_file.map(String);

  return svc;
}

// ─── Serialize ComposeFile → YAML ─────────────────────────────────────────────

export function serializeCompose(cf: ComposeFile): string {
  const out: Record<string, unknown> = {};

  if (cf.version) out.version = cf.version;

  if (cf.services && Object.keys(cf.services).length > 0) {
    out.services = {};
    for (const [name, svc] of Object.entries(cf.services)) {
      (out.services as Record<string, unknown>)[name] = serializeService(svc);
    }
  }

  if (cf.networks && Object.keys(cf.networks).length > 0) out.networks = cf.networks;
  if (cf.volumes && Object.keys(cf.volumes).length > 0) out.volumes = cf.volumes;

  return jsyaml.dump(out, { lineWidth: 120, noRefs: true, quotingType: '"' });
}

function serializeService(svc: ComposeService): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const str = (key: string, val?: string) => { if (val) out[key] = val; };
  const bool = (key: string, val?: boolean) => { if (val) out[key] = val; };

  if (svc.image) str("image", svc.image);
  if (svc.build) {
    if (svc.build.context && !svc.build.dockerfile && !svc.build.args && !svc.build.target) {
      out.build = svc.build.context;
    } else {
      const b: Record<string, unknown> = {};
      if (svc.build.context) b.context = svc.build.context;
      if (svc.build.dockerfile) b.dockerfile = svc.build.dockerfile;
      if (svc.build.target) b.target = svc.build.target;
      if (svc.build.args && Object.keys(svc.build.args).length > 0) b.args = svc.build.args;
      out.build = b;
    }
  }

  str("container_name", svc.container_name);
  str("hostname", svc.hostname);
  if (svc.restart && svc.restart !== "no") str("restart", svc.restart);
  str("command", svc.command);
  str("entrypoint", svc.entrypoint);
  str("user", svc.user);
  str("working_dir", svc.working_dir);
  str("pid", svc.pid);
  bool("privileged", svc.privileged);
  bool("read_only", svc.read_only);
  bool("tty", svc.tty);
  bool("stdin_open", svc.stdin_open);

  if (svc.ports && svc.ports.length > 0) {
    out.ports = svc.ports.map(portSpecToString);
  }

  if (svc.environment && Object.keys(svc.environment).length > 0) {
    out.environment = svc.environment;
  }

  if (svc.volumes && svc.volumes.length > 0) {
    out.volumes = svc.volumes.map(volumeMountToString);
  }

  if (svc.networks && Object.keys(svc.networks).length > 0) {
    out.networks = svc.networks;
  }

  if (svc.depends_on && svc.depends_on.length > 0) {
    const allStarted = svc.depends_on.every((d) => !d.condition || d.condition === "service_started");
    if (allStarted) {
      out.depends_on = svc.depends_on.map((d) => d.service);
    } else {
      const deps: Record<string, unknown> = {};
      for (const d of svc.depends_on) {
        deps[d.service] = { condition: d.condition ?? "service_started" };
      }
      out.depends_on = deps;
    }
  }

  if (svc.healthcheck) {
    const hc: Record<string, unknown> = {};
    if (svc.healthcheck.disable) {
      hc.disable = true;
    } else {
      if (svc.healthcheck.test) hc.test = ["CMD-SHELL", svc.healthcheck.test];
      if (svc.healthcheck.interval) hc.interval = svc.healthcheck.interval;
      if (svc.healthcheck.timeout) hc.timeout = svc.healthcheck.timeout;
      if (svc.healthcheck.retries != null) hc.retries = svc.healthcheck.retries;
      if (svc.healthcheck.startPeriod) hc.start_period = svc.healthcheck.startPeriod;
    }
    if (Object.keys(hc).length > 0) out.healthcheck = hc;
  }

  if (svc.deploy?.resources?.limits) {
    const lim = svc.deploy.resources.limits;
    if (lim.cpus || lim.memory) {
      out.deploy = { resources: { limits: {} } };
      const limOut = (out.deploy as Record<string, Record<string, Record<string, string>>>).resources.limits;
      if (lim.cpus) limOut.cpus = lim.cpus;
      if (lim.memory) limOut.memory = lim.memory;
    }
  }

  if (svc.logging?.driver) {
    const log: Record<string, unknown> = { driver: svc.logging.driver };
    if (svc.logging.options && Object.keys(svc.logging.options).length > 0) {
      log.options = svc.logging.options;
    }
    out.logging = log;
  }

  if (svc.labels && Object.keys(svc.labels).length > 0) out.labels = svc.labels;
  if (svc.env_file && svc.env_file.length > 0) out.env_file = svc.env_file;
  if (svc.extra_hosts && svc.extra_hosts.length > 0) out.extra_hosts = svc.extra_hosts;
  if (svc.cap_add && svc.cap_add.length > 0) out.cap_add = svc.cap_add;
  if (svc.cap_drop && svc.cap_drop.length > 0) out.cap_drop = svc.cap_drop;

  return out;
}
