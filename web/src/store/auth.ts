import { create } from "zustand";

interface AuthStore {
  username: string | null;
  setUser: (username: string | null) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  username: null,
  setUser: (username) => set({ username }),
}));
