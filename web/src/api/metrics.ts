import { api } from "./client";
import type { MetricsSnapshot } from "@/types";

export function getMetrics(): Promise<MetricsSnapshot> {
  return api.get<MetricsSnapshot>("/api/metrics");
}
