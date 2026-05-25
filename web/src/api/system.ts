import { api } from "./client";

export interface VersionInfo {
  version: string;
  goVersion: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  downloadURL: string;
  releaseURL: string;
}

export interface ServerConfig {
  listenAddr: string;
  authMode: string;
  projectsDir: string;
  filesRoot: string;
  tlsCert: string;
  tlsKey: string;
  logSink: string;
  logLevel: string;
  metricsInterval: string;
  metricsRetention: string;
  dataDir: string;
  configPath: string;
}

export type ServerConfigUpdate = Partial<Omit<ServerConfig, "dataDir" | "configPath">>;

export function getVersion() {
  return api.get<VersionInfo>("/api/system/version");
}

export function getUpdateStatus() {
  return api.get<UpdateCheckResult>("/api/system/update/status");
}

export function checkUpdate() {
  return api.get<UpdateCheckResult>("/api/system/update/check");
}

export function getConfig() {
  return api.get<ServerConfig>("/api/system/config");
}

export function updateConfig(data: ServerConfigUpdate) {
  return api.put<{ message: string; requiresRestart: boolean; restartFields: string[] }>("/api/system/config", data);
}
