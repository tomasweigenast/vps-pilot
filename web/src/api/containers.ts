import { api } from "./client";
import type { StandaloneContainer, CreateContainerRequest } from "@/types";

export function listContainers(all = true): Promise<StandaloneContainer[]> {
  return api.get<StandaloneContainer[]>(`/api/containers?all=${all}`);
}

export function createContainer(req: CreateContainerRequest): Promise<{ id: string }> {
  return api.post<{ id: string }>("/api/containers", req);
}

export function removeContainer(id: string): Promise<void> {
  return api.delete<void>(`/api/containers/${id}`);
}
