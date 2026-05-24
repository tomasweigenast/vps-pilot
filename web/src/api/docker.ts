import { api } from "./client";
import type {
  NetworkSummary,
  NetworkDetail,
  VolumeSummary,
  VolumeDetail,
  ImageSummary,
  ContainerInspectResult,
} from "@/types";

// Global lists
export function listAllNetworks(): Promise<NetworkSummary[]> {
  return api.get<NetworkSummary[]>("/api/networks");
}

export function getNetwork(networkId: string): Promise<NetworkDetail> {
  return api.get<NetworkDetail>(`/api/networks/${networkId}`);
}

export function listAllVolumes(): Promise<VolumeSummary[]> {
  return api.get<VolumeSummary[]>("/api/volumes");
}

export function getVolume(volumeName: string): Promise<VolumeDetail> {
  return api.get<VolumeDetail>(`/api/volumes/${encodeURIComponent(volumeName)}`);
}

export function listAllImages(): Promise<ImageSummary[]> {
  return api.get<ImageSummary[]>("/api/images");
}

// Per-project lists
export function listProjectNetworks(projectName: string): Promise<NetworkSummary[]> {
  return api.get<NetworkSummary[]>(`/api/projects/${projectName}/networks`);
}

export function getProjectNetwork(projectName: string, networkId: string): Promise<NetworkDetail> {
  return api.get<NetworkDetail>(`/api/projects/${projectName}/networks/${networkId}`);
}

export function listProjectVolumes(projectName: string): Promise<VolumeSummary[]> {
  return api.get<VolumeSummary[]>(`/api/projects/${projectName}/volumes`);
}

export function getProjectVolume(projectName: string, volumeName: string): Promise<VolumeDetail> {
  return api.get<VolumeDetail>(`/api/projects/${projectName}/volumes/${encodeURIComponent(volumeName)}`);
}

export function listProjectImages(projectName: string): Promise<ImageSummary[]> {
  return api.get<ImageSummary[]>(`/api/projects/${projectName}/images`);
}

export function deleteImage(id: string, force = false): Promise<void> {
  return api.delete(`/api/images/${id}${force ? "?force=true" : ""}`);
}

// Network CRUD
export function createNetwork(req: {
  name: string;
  driver?: string;
  internal?: boolean;
  options?: Record<string, string>;
  labels?: Record<string, string>;
}): Promise<{ id: string }> {
  return api.post<{ id: string }>("/api/networks", req);
}

export function deleteNetwork(networkId: string): Promise<void> {
  return api.delete<void>(`/api/networks/${networkId}`);
}

export function connectContainer(networkId: string, containerId: string): Promise<void> {
  return api.post<void>(`/api/networks/${networkId}/connect`, { containerId });
}

export function disconnectContainer(networkId: string, containerId: string, force = false): Promise<void> {
  return api.post<void>(`/api/networks/${networkId}/disconnect`, { containerId, force });
}

// Volume CRUD
export function createVolume(req: {
  name?: string;
  driver?: string;
  driverOpts?: Record<string, string>;
  labels?: Record<string, string>;
}): Promise<{ name: string }> {
  return api.post<{ name: string }>("/api/volumes", req);
}

export function deleteVolume(volumeName: string, force = false): Promise<void> {
  return api.delete<void>(
    `/api/volumes/${encodeURIComponent(volumeName)}${force ? "?force=true" : ""}`
  );
}

export function inspectContainer(projectName: string, containerId: string): Promise<ContainerInspectResult> {
  return api.get<ContainerInspectResult>(
    `/api/projects/${projectName}/containers/${containerId}/inspect`
  );
}

// Image build
export interface BuildSpec {
  dockerfileContent?: string;
  contextDir?: string;
  dockerfilePath?: string;
  tags?: string[];
  buildArgs?: Record<string, string>;
  target?: string;
  noCache?: boolean;
}

export function startImageBuild(spec: BuildSpec): Promise<{ buildId: string }> {
  return api.post<{ buildId: string }>("/api/images/build", spec);
}
