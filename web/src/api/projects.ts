import { api } from "./client";
import type { Project } from "@/types";

export function listProjects(): Promise<Project[]> {
  return api.get<Project[]>("/api/projects");
}

export function startProject(name: string): Promise<void> {
  return api.post(`/api/projects/${name}/start`);
}

export function stopProject(name: string): Promise<void> {
  return api.post(`/api/projects/${name}/stop`);
}

export function deleteProject(name: string): Promise<void> {
  return api.delete(`/api/projects/${name}`);
}

export interface ProjectForm {
  name: string;
  description?: string;
  composeContent: string;
  env?: Record<string, string>;
}

export function createProject(data: ProjectForm): Promise<void> {
  return api.post("/api/projects", data);
}

export function updateProject(name: string, data: ProjectForm): Promise<void> {
  return api.put(`/api/projects/${name}`, data);
}

export interface ProjectDetail {
  id: number;
  name: string;
  description: string;
  compose: string;
  envVars: Record<string, string>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  files: ProjectFile[];
  removeStaleImages: boolean;
}

export interface ProjectFile {
  id: number;
  projectName: string;
  filename: string;
  content: string;
}

export function getProject(name: string): Promise<ProjectDetail> {
  return api.get<ProjectDetail>(`/api/projects/${name}`);
}

export function listProjectFiles(name: string): Promise<ProjectFile[]> {
  return api.get<ProjectFile[]>(`/api/projects/${name}/files`);
}

export function upsertProjectFile(name: string, filename: string, content: string): Promise<void> {
  return api.put(`/api/projects/${name}/files`, { filename, content });
}

export function deleteProjectFile(name: string, filename: string): Promise<void> {
  return api.delete(`/api/projects/${name}/files/${encodeURIComponent(filename)}`);
}

export function restartProject(name: string): Promise<void> {
  return api.post(`/api/projects/${name}/restart`);
}

export function containerAction(projectName: string, containerId: string, action: "start" | "stop" | "restart"): Promise<void> {
  return api.post(`/api/projects/${projectName}/containers/${containerId}/${action}`);
}

export interface ServiceUpdateInfo {
  hasUpdate: boolean;
  currentImage: string;
  newerImage?: string;
}

export interface UpdateStatus {
  services: Record<string, ServiceUpdateInfo>;
  hasUpdates: boolean;
}

export function checkProjectUpdates(name: string): Promise<UpdateStatus> {
  return api.get<UpdateStatus>(`/api/projects/${name}/updates`);
}
