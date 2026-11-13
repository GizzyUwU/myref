import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { apiTokens, users, type User } from "../db/schema";
import type { ApiTokenInfo } from "./tokens.types";

const tokenPrefix = "myref_";

export function bearerToken(
  authHeader: string | null | undefined,
): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token ? token : null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createApiToken(
  userId: string,
  name: string,
): Promise<{ id: string; token: string; name: string; createdAt: Date }> {
  const token = `${tokenPrefix}${randomBytes(32).toString("base64url")}`;
  const [row] = await db
    .insert(apiTokens)
    .values({ userId, tokenHash: hashToken(token), name: name.slice(0, 100) })
    .returning({
      id: apiTokens.id,
      name: apiTokens.name,
      createdAt: apiTokens.createdAt,
    });
  if (!row) throw new Error("Could not create API token.");
  return { ...row, token };
}

export async function getApiTokenUser(
  rawToken: string | null | undefined,
): Promise<{ user: User; tokenId: string } | null> {
  const token = (rawToken ?? "").trim();
  if (!token.startsWith(tokenPrefix)) return null;

  const [row] = await db
    .select({ user: users, tokenId: apiTokens.id })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, hashToken(token)))
    .limit(1);

  if (!row) return null;

  void db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.tokenId))
    .catch(() => undefined);

  return { user: row.user, tokenId: row.tokenId };
}

export async function revokeCurrentToken(
  authHeader: string | null | undefined,
): Promise<boolean> {
  const token = bearerToken(authHeader);
  if (!token || !token.startsWith(tokenPrefix)) return false;
  const deleted = await db
    .delete(apiTokens)
    .where(eq(apiTokens.tokenHash, hashToken(token)))
    .returning({ id: apiTokens.id });
  return deleted.length > 0;
}

export async function listApiTokens(userId: string): Promise<ApiTokenInfo[]> {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId));
}

export async function revokeApiToken(
  userId: string,
  tokenId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)))
    .returning({ id: apiTokens.id });
  return deleted.length > 0;
}
