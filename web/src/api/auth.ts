import { api } from "./client";

export interface LoginRequest {
  username: string;
  password: string;
}

export async function login(data: LoginRequest): Promise<void> {
  const form = new FormData();
  form.append("username", data.username);
  form.append("password", data.password);
  await api.post("/api/login", form);
}

export async function logout(): Promise<void> {
  await api.post("/api/logout");
}
