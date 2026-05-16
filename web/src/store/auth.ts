import { create } from "zustand";

interface AuthStore {
  username: string | null;
  isAdmin: boolean;
  permissions: string[];
  setUser: (username: string | null, isAdmin: boolean, permissions?: string[]) => void;
  hasPermission: (action: string) => boolean;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  username: null,
  isAdmin: false,
  permissions: [],
  setUser: (username, isAdmin, permissions = []) => set({ username, isAdmin, permissions }),
  hasPermission: (action: string) => {
    const { isAdmin, permissions } = get();
    return isAdmin || permissions.includes(action);
  },
}));
