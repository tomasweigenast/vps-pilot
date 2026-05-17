import { api } from "./client";

export interface Webhook {
  id: number;
  token: string;
  projectName: string;
  serviceName: string;
  createdAt: string;
  lastCalledAt: string | null;
  callCount: number;
}

export function listWebhooks(projectName: string): Promise<Webhook[]> {
  return api.get<Webhook[]>(`/api/projects/${projectName}/webhooks`);
}

export function createProjectWebhook(projectName: string): Promise<Webhook> {
  return api.post<Webhook>(`/api/projects/${projectName}/webhooks`);
}

export function createServiceWebhook(projectName: string, serviceName: string): Promise<Webhook> {
  return api.post<Webhook>(`/api/projects/${projectName}/containers/${serviceName}/webhooks`);
}

export function deleteWebhook(projectName: string, webhookId: number): Promise<void> {
  return api.delete(`/api/projects/${projectName}/webhooks/${webhookId}`);
}

export function patchProjectConfig(projectName: string, config: { removeStaleImages?: boolean }): Promise<void> {
  return api.patch(`/api/projects/${projectName}/config`, config);
}
