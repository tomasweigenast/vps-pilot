import { create } from "zustand";

interface AuthStore {
  username: string | null;
  isAdmin: boolean;
  setUser: (username: string | null, isAdmin: boolean) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  username: null,
  isAdmin: false,
  setUser: (username, isAdmin) => set({ username, isAdmin }),
}));
