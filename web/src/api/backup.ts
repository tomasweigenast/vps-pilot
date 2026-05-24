import { api } from "./client";

export function downloadBackup(): Promise<void> {
  // Trigger a browser download by navigating to the URL
  window.location.href = "/api/backup";
  return Promise.resolve();
}

export async function restoreBackup(file: File): Promise<{ ok: boolean; createdAt: string; note: string }> {
  const form = new FormData();
  form.append("backup", file);

  const resp = await fetch("/api/restore", {
    method: "POST",
    body: form,
    credentials: "include",
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || "Restore failed");
  }

  return resp.json();
}
