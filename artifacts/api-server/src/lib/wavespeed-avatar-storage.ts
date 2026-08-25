import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getSignedObjectUrl, objectStorageClient } from "./objectStorage";
import { getObjectAclPolicy, setObjectAclPolicy } from "./objectAcl";

const MAX_AVATAR_IMAGE_BYTES = 20 * 1024 * 1024;

function privateDirParts(): { bucketName: string; prefix: string } {
  const raw = process.env.PRIVATE_OBJECT_DIR ?? "";
  const parts = raw.split("/").filter(Boolean);
  const bucketName = parts[0];
  if (!bucketName) throw new Error("PRIVATE_OBJECT_DIR not set");
  return { bucketName, prefix: parts.slice(1).join("/") };
}

function objectPathFromName(objectName: string, prefix: string): string {
  const relative = prefix && objectName.startsWith(`${prefix}/`)
    ? objectName.slice(prefix.length + 1)
    : objectName;
  return `/objects/${relative}`;
}

function gcsNameFromObjectPath(objectPath: string): string {
  if (!objectPath.startsWith("/objects/")) {
    throw new Error("Invalid private avatar object path");
  }
  const { prefix } = privateDirParts();
  const relative = objectPath.slice("/objects/".length);
  return [prefix, relative].filter(Boolean).join("/");
}

function extensionForContentType(contentType: string): string {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  return ".jpg";
}

/**
 * Download a completed WaveSpeed result and persist it in Reelsona's private
 * App Storage. The database stores only the /objects/... path, never the
 * provider's temporary CloudFront URL.
 */
export async function persistWaveSpeedAvatarImage(
  sourceUrl: string,
  userId: number,
): Promise<string> {
  if (sourceUrl.startsWith("/objects/")) return sourceUrl;
  if (!/^https?:\/\//i.test(sourceUrl)) {
    throw new Error("WaveSpeed returned an invalid avatar image URL");
  }

  const response = await fetch(sourceUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Could not download WaveSpeed avatar image (${response.status})`);
  }

  const contentType = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  if (!contentType.startsWith("image/")) {
    throw new Error(`WaveSpeed avatar result is not an image (${contentType})`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_AVATAR_IMAGE_BYTES) {
    throw new Error("WaveSpeed avatar image is too large");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_AVATAR_IMAGE_BYTES) {
    throw new Error("WaveSpeed avatar image has an invalid size");
  }

  const { bucketName, prefix } = privateDirParts();
  const objectName = [prefix, "wavespeed-avatars", `u${userId}`, `${randomUUID()}${extensionForContentType(contentType)}`]
    .filter(Boolean)
    .join("/");
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buffer, { contentType, resumable: false });

  const objectPath = objectPathFromName(objectName, prefix);
  const existingPolicy = await getObjectAclPolicy(file);
  if (existingPolicy && existingPolicy.owner !== String(userId)) {
    throw new Error("Stored avatar object ownership conflict");
  }
  if (!existingPolicy) {
    await setObjectAclPolicy(file, { owner: String(userId), visibility: "private" });
  }
  await db.execute(sql`
    INSERT INTO private_object_ownership (object_path, user_id)
    VALUES (${objectPath}, ${userId})
    ON CONFLICT (object_path) DO NOTHING
  `);

  return objectPath;
}

/** Signed URL for passing a private stored look back to WaveSpeed. */
export async function getWaveSpeedProviderImageUrl(imagePath: string): Promise<string> {
  if (!imagePath.startsWith("/objects/")) return imagePath;
  return getSignedObjectUrl(gcsNameFromObjectPath(imagePath), 4 * 3600);
}

/** Same-origin URL for an authenticated browser request. */
export function getWaveSpeedBrowserImageUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  return imagePath.startsWith("/objects/")
    ? `/api/storage${imagePath}`
    : imagePath;
}