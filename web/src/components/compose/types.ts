// TypeScript types mirroring Docker Compose v3 schema (subset used in the visual builder).

export interface PortSpec {
  host?: string;         // host port or range
  container: string;     // container port or range
  protocol?: "tcp" | "udp";
}

export interface VolumeMount {
  source: string;
  target: string;
  readOnly?: boolean;
}

export interface BuildConfig {
  context?: string;
  dockerfile?: string;
  args?: Record<string, string>;
  target?: string;
}

export interface HealthCheck {
  test?: string;
  interval?: string;
  timeout?: string;
  retries?: number;
  startPeriod?: string;
  disable?: boolean;
}

export interface ResourceLimits {
  cpus?: string;      // e.g. "0.5"
  memory?: string;    // e.g. "512m"
}

export interface LoggingConfig {
  driver?: string;
  options?: Record<string, string>;
}

export interface DependsOnEntry {
  service: string;
  condition?: "service_started" | "service_healthy" | "service_completed_successfully";
}

export interface ServiceNetworkConfig {
  aliases?: string[];
  ipv4_address?: string;
}

export interface ComposeService {
  image?: string;
  build?: BuildConfig;
  container_name?: string;
  hostname?: string;
  restart?: "no" | "always" | "on-failure" | "unless-stopped";
  ports?: PortSpec[];
  environment?: Record<string, string>;
  volumes?: VolumeMount[];
  networks?: Record<string, ServiceNetworkConfig>;
  depends_on?: DependsOnEntry[];
  healthcheck?: HealthCheck;
  deploy?: {
    resources?: {
      limits?: ResourceLimits;
    };
  };
  logging?: LoggingConfig;
  labels?: Record<string, string>;
  command?: string;
  entrypoint?: string;
  user?: string;
  working_dir?: string;
  env_file?: string[];
  privileged?: boolean;
  read_only?: boolean;
  tty?: boolean;
  stdin_open?: boolean;
  extra_hosts?: string[];
  cap_add?: string[];
  cap_drop?: string[];
  pid?: string;
}

export interface ComposeNetwork {
  driver?: string;
  external?: boolean;
  name?: string;
  ipam?: {
    driver?: string;
    config?: Array<{ subnet?: string }>;
  };
}

export interface ComposeVolume {
  driver?: string;
  external?: boolean;
  name?: string;
  driver_opts?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface ComposeFile {
  version?: string;
  services?: Record<string, ComposeService>;
  networks?: Record<string, ComposeNetwork | null>;
  volumes?: Record<string, ComposeVolume | null>;
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

export function parsePortSpec(str: string): PortSpec {
  // Handles: "80", "80:8080", "80:8080/tcp", "127.0.0.1:80:8080"
  const protoSplit = str.split("/");
  const protocol = (protoSplit[1] as "tcp" | "udp") ?? undefined;
  const parts = protoSplit[0].split(":");

  if (parts.length === 1) {
    return { container: parts[0], protocol };
  }
  if (parts.length === 2) {
    return { host: parts[0], container: parts[1], protocol };
  }
  // "ip:host:container"
  return { host: `${parts[0]}:${parts[1]}`, container: parts[2], protocol };
}

export function portSpecToString(p: PortSpec): string {
  const proto = p.protocol && p.protocol !== "tcp" ? `/${p.protocol}` : "";
  if (p.host) return `${p.host}:${p.container}${proto}`;
  return `${p.container}${proto}`;
}

export function parseVolumeMount(str: string): VolumeMount {
  const parts = str.split(":");
  if (parts.length === 1) return { source: "", target: parts[0] };
  if (parts.length === 2) return { source: parts[0], target: parts[1] };
  return { source: parts[0], target: parts[1], readOnly: parts[2] === "ro" };
}

export function volumeMountToString(v: VolumeMount): string {
  if (!v.source) return v.target;
  const suffix = v.readOnly ? ":ro" : "";
  return `${v.source}:${v.target}${suffix}`;
}
