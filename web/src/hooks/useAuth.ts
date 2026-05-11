import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";

export function useAuth() {
  const setUser = useAuthStore((s) => s.setUser);

  const query = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ username: string }>("/api/me"),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (query.data) setUser(query.data.username);
    else if (query.isError) setUser(null);
  }, [query.data, query.isError, setUser]);

  return {
    username: query.data?.username ?? null,
    isLoading: query.isPending,
    isAuthenticated: query.isSuccess,
  };
}
