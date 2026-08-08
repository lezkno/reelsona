/**
 * Password hashing using Node.js built-in crypto (scrypt).
 * No external dependencies required.
 */
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

const SALT_LEN = 16;
const KEY_LEN = 64;

/**
 * Hash a plain-text password. Returns a "salt:hash" string safe to store in DB.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify a plain-text password against a stored "salt:hash" string.
 * Uses timingSafeEqual to prevent timing attacks.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  try {
    const hashBuffer = Buffer.from(hash, "hex");
    const derived = scryptSync(password, salt, KEY_LEN);
    return timingSafeEqual(derived, hashBuffer);
  } catch {
    return false;
  }
}
