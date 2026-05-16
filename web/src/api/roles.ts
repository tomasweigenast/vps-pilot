import { api } from "./client";
import type { Role, Permission } from "@/types";

export async function getRoles(): Promise<Role[]> {
  return api.get<Role[]>("/api/roles");
}

export async function createRole(data: {
  name: string;
  description: string;
  permissions: Omit<Permission, "id" | "roleId">[];
}): Promise<Role> {
  return api.post("/api/roles", data);
}

export async function updateRole(
  id: number,
  data: {
    name: string;
    description: string;
    permissions: Omit<Permission, "id" | "roleId">[];
  }
): Promise<void> {
  return api.put(`/api/roles/${id}`, data);
}

export async function deleteRole(id: number): Promise<void> {
  return api.delete(`/api/roles/${id}`);
}
