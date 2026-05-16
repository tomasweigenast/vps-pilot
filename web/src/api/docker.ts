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

export function inspectContainer(projectName: string, containerId: string): Promise<ContainerInspectResult> {
  return api.get<ContainerInspectResult>(
    `/api/projects/${projectName}/containers/${containerId}/inspect`
  );
}
