import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import type { Cookie } from "elysia";
import { db } from "../db";
import { sessions, users, type User } from "../db/schema";
import { env } from "../env";
import { unauthorized } from "./http";

export const sessionCookieKey = "myref_session";

export type SessionCookies = Record<string, Cookie<unknown>>;

export type PublicUser = Pick<User, "id" | "username" | "createdAt">;

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
): void {
  const session = cookie[sessionCookieKey];
  if (!session) return;
  session.value = token;
  session.path = "/";
  session.httpOnly = true;
  session.sameSite = "lax";
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
): Promise<User | null> {
  const token = cookie[sessionCookieKey]?.value;
  if (typeof token !== "string" || !token) return null;

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
  if (!row) return null;
  return row.user;
}

export async function requireUser(cookie: SessionCookies): Promise<User> {
  const user = await getSessionUser(cookie);
  if (!user) unauthorized();
  return user;
}

export async function destroySession(cookie: SessionCookies): Promise<void> {
  const token = cookie[sessionCookieKey]?.value;
  if (typeof token !== "string" || !token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Delete every session for the user except the one in the given cookie,
 *  so a password change revokes stolen sessions without logging the user
 *  out of their current device. */
export async function destroyOtherSessions(
  cookie: SessionCookies,
  userId: string,
): Promise<void> {
  const token = cookie[sessionCookieKey]?.value;
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
