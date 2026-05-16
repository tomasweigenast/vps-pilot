import { api } from "./client";
import type { UserView, Permission } from "@/types";

export async function getUsers(): Promise<UserView[]> {
  return api.get<UserView[]>("/api/users");
}

export async function createUser(data: {
  username: string;
  password: string;
  roleIds?: number[];
  permissions?: Pick<Permission, "projectName" | "actions">[];
}): Promise<{ id: number; username: string }> {
  return api.post("/api/users", data);
}

export async function updateUser(
  id: number,
  data: {
    disabled?: boolean;
    roleIds?: number[];
    permissions?: Pick<Permission, "projectName" | "actions">[];
    clearPermissions?: boolean;
  }
): Promise<void> {
  return api.patch(`/api/users/${id}`, data);
}

export async function deleteUser(id: number): Promise<void> {
  return api.delete(`/api/users/${id}`);
}
