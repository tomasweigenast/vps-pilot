import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";

export function useAuth() {
  const setUser = useAuthStore((s) => s.setUser);

  const query = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ username: string; isAdmin: boolean; permissions: string[] }>("/api/me"),
    retry: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (query.data) setUser(query.data.username, query.data.isAdmin ?? false, query.data.permissions ?? []);
    else if (query.isError) setUser(null, false, []);
  }, [query.data, query.isError, setUser]);

  return {
    username: query.data?.username ?? null,
    isLoading: query.isPending,
    isAuthenticated: query.isSuccess,
  };
}
