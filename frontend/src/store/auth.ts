import { createSignal } from "solid-js";
import { api } from "../api";
import type { User } from "../types";

const [user, setUser] = createSignal<User | null>(null);
const [ready, setReady] = createSignal(false);

let pending: Promise<void> | null = null;

async function loadMe(): Promise<void> {
  if (pending) return pending;

  pending = (async () => {
    try {
      const result = await api.me();
      setUser(result.user);
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  })();

  return pending;
}

async function login(identifier: string, password: string): Promise<User> {
  const result = await api.login({ identifier, password });
  setUser(result.user);
  return result.user;
}

async function register(input: {
  email: string;
  username: string;
  password: string;
}): Promise<User> {
  const result = await api.register(input);
  setUser(result.user);
  return result.user;
}

async function logout(): Promise<void> {
  try {
    await api.logout();
  } finally {
    setUser(null);
  }
}

export const auth = {
  user,
  ready,
  loadMe,
  login,
  register,
  logout,
  setUser,
};

export function userInitials(username: string): string {
  return username.slice(0, 2).toUpperCase();
}
