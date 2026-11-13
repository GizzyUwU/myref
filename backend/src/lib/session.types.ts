import type { Cookie } from "elysia";
import type { User } from "../db/schema";

export type SessionCookies = Record<string, Cookie<unknown>>;

export type PublicUser = Pick<User, "id" | "username" | "createdAt">;
