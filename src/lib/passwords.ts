import { randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384,
  r = 8,
  p = 1,
  keylen = 64;
function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key))),
  );
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, rr, pp, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !n || !rr || !pp || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  if (expected.length !== keylen) return false;
  const key = await derive(password, Buffer.from(salt, "base64"), {
    N: Number(n),
    r: Number(rr),
    p: Number(pp),
  });
  return timingSafeEqual(key, expected);
}
