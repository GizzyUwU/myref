import { sql } from "drizzle-orm";
import { db } from "./db";
import { sessions, users } from "./db/schema";
import { hashPassword } from "./lib/password";

function usage(): never {
  console.error(`Usage:
  bun src/cli.ts list-users
  bun src/cli.ts reset-password <email|username> <new-password>

  reset-password sets a new password (8-128 characters) and revokes
  all existing sessions for the account.`);
  process.exit(1);
}

async function listUsers(): Promise<void> {
  const rows = await db
    .select({ email: users.email, username: users.username })
    .from(users);
  for (const row of rows) {
    console.log(`${row.username} <${row.email}>`);
  }
  console.log(`${rows.length} user(s).`);
}

async function resetPassword(
  identifier: string,
  newPassword: string,
): Promise<void> {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) {
    console.error("Enter an email address or username.");
    process.exit(1);
  }
  if (newPassword.length < 8) {
    console.error("New password must be at least 8 characters.");
    process.exit(1);
  }
  if (newPassword.length > 128) {
    console.error("New password must be 128 characters or fewer.");
    process.exit(1);
  }

  const [user] = await db
    .select()
    .from(users)
    .where(
      sql`lower(${users.email}) = ${normalized} or lower(${users.username}) = ${normalized}`,
    )
    .limit(1);

  if (!user) {
    console.error(`No account found for "${identifier}".`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash }).where(sql`${users.id} = ${user.id}`);
  const revoked = await db
    .delete(sessions)
    .where(sql`${sessions.userId} = ${user.id}`)
    .returning({ id: sessions.id });

  console.log(
    `Password reset for ${user.username} <${user.email}>. ${revoked.length} session(s) revoked.`,
  );
}

const [command, ...args] = process.argv.slice(2);

if (command === "list-users" && args.length === 0) {
  await listUsers();
} else if (command === "reset-password" && args.length === 2) {
  await resetPassword(args[0]!, args[1]!);
} else {
  usage();
}

process.exit(0);
