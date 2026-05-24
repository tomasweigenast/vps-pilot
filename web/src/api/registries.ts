import { api } from "./client";

export interface Registry {
  id: number;
  name: string;
  url: string;
  username: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegistryForm {
  name: string;
  url: string;
  username: string;
  secret: string;
}

export function listRegistries(): Promise<Registry[]> {
  return api.get<Registry[]>("/api/registries");
}

export function createRegistry(data: RegistryForm): Promise<Registry> {
  return api.post<Registry>("/api/registries", data);
}

export function updateRegistry(id: number, data: RegistryForm): Promise<void> {
  return api.put(`/api/registries/${id}`, data);
}

export function deleteRegistry(id: number): Promise<void> {
  return api.delete(`/api/registries/${id}`);
}

export function testRegistry(id: number): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/api/registries/${id}/test`);
}

export function listRepositories(id: number): Promise<string[]> {
  return api.get<string[]>(`/api/registries/${id}/repositories`);
}

export function listRepoTags(id: number, repoName: string): Promise<string[]> {
  return api.get<string[]>(`/api/registries/${id}/repositories/${repoName}/tags`);
}

export function searchImageTags(image: string, q?: string, registryId?: number): Promise<string[]> {
  const params = new URLSearchParams({ image });
  if (q) params.set("q", q);
  if (registryId != null) params.set("registryId", String(registryId));
  return api.get<string[]>(`/api/images/tags?${params}`);
}
