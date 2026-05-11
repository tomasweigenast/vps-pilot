import { api } from "./client";
import type { Project } from "@/types";

export function listProjects(): Promise<Project[]> {
  return api.get<Project[]>("/api/projects");
}

export function startProject(name: string): Promise<void> {
  return api.post(`/projects/${name}/start`);
}

export function stopProject(name: string): Promise<void> {
  return api.post(`/projects/${name}/stop`);
}

export function deleteProject(name: string): Promise<void> {
  return api.delete(`/projects/${name}`);
}

export interface ProjectForm {
  name: string;
  composeContent: string;
}

export function createProject(data: ProjectForm): Promise<void> {
  return api.post("/projects", data);
}

export function updateProject(name: string, data: ProjectForm): Promise<void> {
  return api.put(`/projects/${name}`, data);
}
