import { api } from "./client";
import type { Secret, ProjectSecret } from "@/types";

export function listSecrets(): Promise<Secret[]> {
  return api.get<Secret[]>("/api/secrets");
}

export function createSecret(data: {
  name: string;
  description: string;
  value: string;
}): Promise<Secret> {
  return api.post<Secret>("/api/secrets", data);
}

export function updateSecret(
  id: number,
  data: { description: string; value?: string }
): Promise<void> {
  return api.put<void>(`/api/secrets/${id}`, data);
}

export function deleteSecret(id: number): Promise<void> {
  return api.delete<void>(`/api/secrets/${id}`);
}

export function revealSecret(id: number): Promise<{ value: string }> {
  return api.post<{ value: string }>(`/api/secrets/${id}/reveal`, {});
}

export function listProjectSecrets(projectName: string): Promise<ProjectSecret[]> {
  return api.get<ProjectSecret[]>(`/api/projects/${projectName}/secrets`);
}

export function setProjectSecrets(
  projectName: string,
  secrets: Array<{ secretId: number; envVarName: string }>
): Promise<void> {
  return api.put<void>(`/api/projects/${projectName}/secrets`, { secrets });
}
