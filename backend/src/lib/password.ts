export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "bcrypt", cost: 12 });
}

export function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

export function verifyPasswordSafe(
  password: string,
  hash: string | null | undefined,
): Promise<boolean> {
  return Bun.password.verify(
    password,
    hash ?? "$2b$12$X6kvcLnYAZH9UhCU00m9D.p25Kvux1hUNFVQpuOBtRcMdGbT6zHCa",
  );
}
