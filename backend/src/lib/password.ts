export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "bcrypt", cost: 12 });
}

export function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

// Random bcrypt hash (cost 12) that matches no real password. Verifying
// against it when an account doesn't exist keeps login timing identical for
// existing and missing accounts, so response time can't reveal which
// usernames are registered.
export const DUMMY_PASSWORD_HASH =
  "$2b$12$X6kvcLnYAZH9UhCU00m9D.p25Kvux1hUNFVQpuOBtRcMdGbT6zHCa";
