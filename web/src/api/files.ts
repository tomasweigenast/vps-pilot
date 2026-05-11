import { api } from "./client";
import type { FileEntry } from "@/types";

export function listFiles(path: string): Promise<FileEntry[]> {
  return api.get<FileEntry[]>(`/api/files?path=${encodeURIComponent(path)}`);
}
