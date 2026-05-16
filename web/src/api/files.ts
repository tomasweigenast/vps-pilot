import { api } from "./client";
import type { FileEntry } from "@/types";

export function listFiles(path: string): Promise<FileEntry[]> {
  return api.get<FileEntry[]>(`/api/files?path=${encodeURIComponent(path)}`);
}

export function getFileContent(path: string): Promise<{ content: string; path: string }> {
  return api.get(`/api/files/content?path=${encodeURIComponent(path)}`);
}

export function updateFile(path: string, content: string): Promise<void> {
  return api.put(`/api/files?path=${encodeURIComponent(path)}`, { content });
}

export function deleteFile(path: string): Promise<void> {
  return api.delete(`/api/files?path=${encodeURIComponent(path)}`);
}
