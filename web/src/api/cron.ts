import { api } from "./client";

export type EntryType = "job" | "comment" | "env" | "blank";

export interface CronEntry {
  id: string;
  type: EntryType;
  // job fields
  disabled?: boolean;
  special?: string;
  minute?: string;
  hour?: string;
  day?: string;
  month?: string;
  weekday?: string;
  command?: string;
  comment?: string;
  nextRun?: string;
  // comment / env / blank
  raw?: string;
}

export interface CrontabResponse {
  raw: string;
  entries: CronEntry[];
}

export function listCronUsers(): Promise<string[]> {
  return api.get<string[]>("/api/cron/users");
}

export function getCrontab(user: string): Promise<CrontabResponse> {
  return api.get<CrontabResponse>(`/api/cron/${encodeURIComponent(user)}`);
}

export function saveCrontabRaw(user: string, content: string): Promise<void> {
  return api.put(`/api/cron/${encodeURIComponent(user)}/raw`, { content });
}

export function saveCrontabEntries(user: string, entries: CronEntry[]): Promise<void> {
  return api.put(`/api/cron/${encodeURIComponent(user)}/entries`, entries);
}

export interface ValidateResult {
  nextRuns: string[];
}

export function validateCronExpression(expression: string, count = 5): Promise<ValidateResult> {
  return api.post<ValidateResult>("/api/cron/validate", { expression, count });
}
