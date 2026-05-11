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
}

export interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
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
