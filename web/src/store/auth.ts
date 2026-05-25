import { create } from "zustand";
import type { UpdateCheckResult } from "@/api/system";

interface AuthStore {
  username: string | null;
  isAdmin: boolean;
  permissions: string[];
  hasUpdate: boolean;
  latestVersion: string;
  releaseURL: string;
  setUser: (username: string | null, isAdmin: boolean, permissions?: string[]) => void;
  hasPermission: (action: string) => boolean;
  setUpdateInfo: (info: UpdateCheckResult | null) => void;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  username: null,
  isAdmin: false,
  permissions: [],
  hasUpdate: false,
  latestVersion: "",
  releaseURL: "",
  setUser: (username, isAdmin, permissions = []) => set({ username, isAdmin, permissions }),
  hasPermission: (action: string) => {
    const { isAdmin, permissions } = get();
    return isAdmin || permissions.includes(action);
  },
  setUpdateInfo: (info) =>
    set({
      hasUpdate: info?.hasUpdate ?? false,
      latestVersion: info?.latestVersion ?? "",
      releaseURL: info?.releaseURL ?? "",
    }),
}));
