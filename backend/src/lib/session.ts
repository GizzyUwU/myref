import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { sessions, users, type User } from "../db/schema";
import { env } from "../env";
import { unauthorized } from "./http";
import { getApiTokenUser, bearerToken } from "./tokens";
import type { PublicUser, SessionCookies } from "./session.types";

export const sessionCookieKey = "myref_session";

export const extensionOriginPatterns = [
  /^chrome-extension:\/\/[a-z]+$/,
  /^moz-extension:\/\/[^/]+$/,
];

export function isExtensionOrigin(
  origin: string | null | undefined,
): boolean {
  if (!origin) return false;
  if (env.extensionOrigins.includes(origin)) return true;
  return extensionOriginPatterns.some((pattern) => pattern.test(origin));
}

export function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function setSessionCookie(
  cookie: SessionCookies,
  token: string,
  options?: { crossSite?: boolean },
): void {
  const session = cookie[sessionCookieKey];
  if (!session) return;
  session.value = token;
  session.path = "/";
  session.httpOnly = true;
  if (options?.crossSite) {
    session.sameSite = "none";
    session.secure = true;
  } else {
    session.sameSite = "lax";
  }
  session.maxAge = env.sessionDays * 24 * 60 * 60;
  if (env.isProduction) session.secure = true;
}

export function clearSessionCookie(cookie: SessionCookies): void {
  cookie[sessionCookieKey]?.remove();
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.sessionDays * 24 * 60 * 60 * 1000);

  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), sql`${sessions.expiresAt} < now()`));

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  return token;
}

export async function getSessionUser(
  cookie: SessionCookies,
  authHeader?: string | null,
): Promise<User | null> {
  const info = await getAuthInfo(cookie, authHeader);
  return info.user;
}

export async function getAuthInfo(
  cookie: SessionCookies,
  authHeader?: string | null,
): Promise<{ user: User | null; tokenId: string | null }> {
  const tokenAuth = await getApiTokenUser(bearerToken(authHeader));
  if (tokenAuth) return { user: tokenAuth.user, tokenId: tokenAuth.tokenId };

  const token = cookie[sessionCookieKey]?.value;
  if (typeof token !== "string" || !token)
    return { user: null, tokenId: null };

  const rows = await db
    .select({ user: users, sessionId: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return { user: null, tokenId: null };
  return { user: row.user, tokenId: null };
}

export async function requireUser(
  cookie: SessionCookies,
  authHeader?: string | null,
): Promise<User> {
  const user = await getSessionUser(cookie, authHeader);
  if (!user) unauthorized();
  return user;
}

export async function destroySession(cookie: SessionCookies): Promise<void> {
  const token = cookie[sessionCookieKey]?.value;
  if (typeof token !== "string" || !token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function destroyOtherSessions(
  cookie: SessionCookies,
  userId: string,
  authHeader?: string | null,
): Promise<void> {
  const token =
    bearerToken(authHeader) ??
    (typeof cookie[sessionCookieKey]?.value === "string"
      ? (cookie[sessionCookieKey]?.value as string)
      : undefined);
  if (typeof token !== "string" || !token) {
    await db.delete(sessions).where(eq(sessions.userId, userId));
    return;
  }
  await db
    .delete(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        ne(sessions.tokenHash, hashToken(token)),
      ),
    );
}
