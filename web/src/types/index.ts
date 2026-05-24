export interface MetricsSnapshot {
  timestamp: string;
  cpu: {
    usagePercent: number;
    cores: number;
  };
  memory: {
    used: number;
    total: number;
    available: number;
    usedPercent: number;
  };
  disks: DiskStat[];
  network: NetworkStat[];
}

export interface DiskStat {
  path: string;
  used: number;
  total: number;
  free: number;
  usedPercent: number;
}

export interface NetworkStat {
  interface: string;
  bytesSent: number;
  bytesRecv: number;
  packetsSent: number;
  packetsRecv: number;
}

export interface Project {
  name: string;
  dir: string;
  status: "running" | "stopped" | "partial" | "unknown";
  containers: Container[];
  description: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Container {
  id: string;
  name: string;
  serviceName: string; // com.docker.compose.service label
  image: string;
  state: string;
  status: string;
  ports: string;
  health: string; // "healthy" | "unhealthy" | "starting" | "none"
}

export interface LogEntry {
  id: number;
  timestamp: string;
  level: string;
  message: string;
  fields: Record<string, unknown>;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modTime: string;
}

export interface DeployEvent {
  type: "pull_start" | "pull_layer" | "pull_done" | "compose" | "done";
  image?: string;
  layer?: string;
  status?: string;
  current?: number;
  total?: number;
  line?: string;
  success?: boolean;
  error?: string;
}

export interface WSMessage<T = unknown> {
  type: string;
  data: T;
}

export interface ContainerStat {
  name: string;
  cpuPercent: number;
  memUsed: number;
  memLimit: number;
}

export interface Permission {
  id: number;
  roleId: number;
  projectName: string;
  actions: string[];
}

export interface Role {
  id: number;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: string;
  permissions: Permission[];
}

// --- Docker Resources ---

export interface NetworkSummary {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  labels: Record<string, string>;
  associatedProject: string;
  inUse: boolean;
  created: string;
}

export interface NetworkEndpoint {
  name: string;
  ip: string;
  macAddr: string;
}

export interface NetworkIPAMConfig {
  subnet: string;
  gateway: string;
}

export interface NetworkDetail extends NetworkSummary {
  ipamConfigs: NetworkIPAMConfig[];
  options: Record<string, string>;
  containers: NetworkEndpoint[];
}

export interface VolumeSummary {
  name: string;
  driver: string;
  mountpoint: string;
  labels: Record<string, string>;
  associatedProject: string;
  inUse: boolean;
  createdAt: string;
}

export interface VolumeDetail extends VolumeSummary {
  options: Record<string, string>;
  mountedBy: string[];
}

export interface ImageSummary {
  id: string;
  repoTags: string[];
  size: number;
  created: number;
  inUse: boolean;
}

export interface ContainerHealthLog {
  start: string;
  end: string;
  exitCode: number;
  output: string;
}

export interface ContainerHealth {
  status: string;
  failingStreak: number;
  log: ContainerHealthLog[];
}

export interface ContainerNetworkInfo {
  name: string;
  ip: string;
  gateway: string;
  mac: string;
}

export interface ContainerMount {
  type: string;
  name: string;
  source: string;
  destination: string;
  mode: string;
  rw: boolean;
}

export interface ContainerPort {
  ip: string;
  privatePort: number;
  publicPort: number;
  type: string;
}

export interface ContainerDetailState {
  status: string;
  running: boolean;
  paused: boolean;
  restarting: boolean;
  exitCode: number;
  startedAt: string;
  finishedAt: string;
  health?: ContainerHealth;
}

export interface ContainerInspectResult {
  id: string;
  name: string;
  image: string;
  state: ContainerDetailState;
  command: string[];
  entrypoint: string[];
  env: string[];
  labels: Record<string, string>;
  networks: ContainerNetworkInfo[];
  mounts: ContainerMount[];
  ports: ContainerPort[];
  restartPolicy: string;
  platform: string;
  created: string;
}

export interface UserView {
  id: number;
  username: string;
  authType: "pam" | "local";
  disabled: boolean;
  roles: Role[];
  customPermissions: Permission[];
  lastLogin: string | null;
}

// --- Secrets ---

export interface Secret {
  id: number;
  name: string;
  description: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSecret {
  secretId: number;
  secretName: string;
  envVarName: string;
}

// --- Standalone Containers ---

export interface StandaloneContainer {
  id: string;
  names: string[];
  image: string;
  state: string;
  status: string;
  created: number;
  ports: PortMapping[];
  labels: Record<string, string>;
  composeProject?: string;
}

export interface PortMapping {
  hostIP?: string;
  hostPort?: number;
  containerPort: number;
  protocol: string;
}

export interface CreateContainerRequest {
  image: string;
  name?: string;
  env?: string[];
  ports?: PortSpec[];
  volumes?: string[];
  restartPolicy?: string;
  entrypoint?: string[];
  cmd?: string[];
  labels?: Record<string, string>;
}

export interface PortSpec {
  hostPort: string;
  containerPort: string;
  protocol?: string;
}

// --- Host Info ---

export interface EngineInfo {
  apiVersion: string;
  rootDir: string;
  storageDriver: string;
  loggingDriver: string;
  volumePlugins: string[];
  networkPlugins: string[];
  containersRunning: number;
  containersStopped: number;
  imageCount: number;
}

export interface HostInfo {
  hostname: string;
  os: string;
  platform: string;
  platformVersion: string;
  kernelVersion: string;
  kernelArch: string;
  uptimeSeconds: number;
  bootTime: number;
  totalCpu: number;
  totalMemoryBytes: number;
  virtualizationSystem?: string;
  dockerVersion?: string;
  engineInfo?: EngineInfo;
}
