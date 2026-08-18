import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "./logger";

const PREFIX = "enc:v1:";
const IV_BYTES = 12;

let warnedFallback = false;

function getKey(): Buffer {
  const explicit = process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY?.trim();
  const fallback = process.env.SESSION_SECRET?.trim();
  const material = explicit || fallback;

  if (!material) {
    throw new Error(
      "Instagram token encryption requires INSTAGRAM_TOKEN_ENCRYPTION_KEY or SESSION_SECRET",
    );
  }

  if (!explicit && !warnedFallback) {
    warnedFallback = true;
    logger.warn(
      "INSTAGRAM_TOKEN_ENCRYPTION_KEY is not set; deriving Instagram token encryption from SESSION_SECRET. Set a dedicated key before rotating SESSION_SECRET.",
    );
  }

  return createHash("sha256").update(material, "utf8").digest();
}

export function isEncryptedInstagramToken(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptInstagramToken(token: string): string {
  if (!token) return token;
  if (isEncryptedInstagramToken(token)) return token;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptInstagramToken(storedToken: string): string {
  if (!storedToken) return storedToken;
  if (!isEncryptedInstagramToken(storedToken)) return storedToken;

  const payload = storedToken.slice(PREFIX.length);
  const [ivPart, tagPart, ciphertextPart] = payload.split(".");
  if (!ivPart || !tagPart || !ciphertextPart) {
    throw new Error("Invalid encrypted Instagram token format");
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getKey(),
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (error) {
    throw new Error(
      "Unable to decrypt Instagram token. Verify INSTAGRAM_TOKEN_ENCRYPTION_KEY/SESSION_SECRET has not changed.",
      { cause: error },
    );
  }
}

/**
 * Encrypt legacy plaintext Instagram tokens before application traffic is enabled.
 * Safe to call on every startup; already-encrypted rows are ignored.
 */
export async function migrateInstagramTokensAtRest(): Promise<void> {
  const result = await pool.query<{ id: number; access_token: string }>(
    `SELECT id, access_token
       FROM instagram_accounts
      WHERE access_token IS NOT NULL
        AND access_token <> ''
        AND access_token NOT LIKE $1`,
    [`${PREFIX}%`],
  );

  let migrated = 0;
  for (const row of result.rows) {
    const encrypted = encryptInstagramToken(row.access_token);
    const updated = await pool.query(
      `UPDATE instagram_accounts
          SET access_token = $2, updated_at = NOW()
        WHERE id = $1
          AND access_token = $3`,
      [row.id, encrypted, row.access_token],
    );
    if ((updated.rowCount ?? 0) > 0) migrated += 1;
  }

  if (migrated > 0) {
    logger.info({ migrated }, "Encrypted legacy Instagram access tokens at rest");
  }
}
