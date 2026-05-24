import { api } from "./client";
import type { MetricsSnapshot, HostInfo } from "@/types";

export function getMetrics(): Promise<MetricsSnapshot> {
  return api.get<MetricsSnapshot>("/api/metrics");
}

export function getSystemInfo(): Promise<HostInfo> {
  return api.get<HostInfo>("/api/system/info");
}
