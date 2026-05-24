import { api } from "./client";

export interface NotificationRule {
  id: number;
  channelId: number;
  eventType: string;
  projectFilter?: string | null;
  enabled: boolean;
}

export interface NotificationChannel {
  id: number;
  name: string;
  type: "email" | "webhook" | "slack" | "discord";
  config: string; // raw JSON
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  rules: NotificationRule[];
}

export interface ChannelForm {
  name: string;
  type: string;
  config: string;
  enabled: boolean;
}

export interface RuleForm {
  eventType: string;
  projectFilter?: string | null;
  enabled: boolean;
}

export const EVENT_TYPES = [
  { value: "container.die", label: "Container stopped/died" },
  { value: "container.health_status", label: "Container health status change" },
  { value: "deploy.success", label: "Deploy succeeded" },
  { value: "deploy.fail", label: "Deploy failed" },
  { value: "container.oom", label: "Container OOM killed" },
  { value: "container.start", label: "Container started" },
];

export function listChannels(): Promise<NotificationChannel[]> {
  return api.get<NotificationChannel[]>("/api/notifications/channels");
}

export function createChannel(data: ChannelForm): Promise<NotificationChannel> {
  return api.post<NotificationChannel>("/api/notifications/channels", data);
}

export function updateChannel(id: number, data: ChannelForm): Promise<void> {
  return api.put(`/api/notifications/channels/${id}`, data);
}

export function deleteChannel(id: number): Promise<void> {
  return api.delete(`/api/notifications/channels/${id}`);
}

export function testChannel(id: number): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/api/notifications/channels/${id}/test`);
}

export function createRule(channelId: number, data: RuleForm): Promise<NotificationRule> {
  return api.post<NotificationRule>(`/api/notifications/channels/${channelId}/rules`, data);
}

export function updateRule(id: number, data: RuleForm): Promise<void> {
  return api.put(`/api/notifications/rules/${id}`, data);
}

export function deleteRule(id: number): Promise<void> {
  return api.delete(`/api/notifications/rules/${id}`);
}
