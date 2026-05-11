import { api } from "./client";
import type { LogEntry } from "@/types";

export function getLogHistory(): Promise<LogEntry[]> {
  return api.get<LogEntry[]>("/api/logs/history");
}
