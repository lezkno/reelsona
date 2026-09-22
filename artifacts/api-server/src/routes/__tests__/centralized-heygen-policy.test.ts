import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("HeyGen routes do not resolve or persist user API keys", () => {
  const source = read("routes/heygen.ts");

    const mutations = source.match(
      new RegExp(`(?:delete|update)\\(${table}\\)[\\s\\S]*?\\.where\\(([\\s\\S]*?)\\)\\)`, "g"),
    ) ?? [];
  assert.doesNotMatch(
    source,
    /export function use(?:UploadHeyGenAsset|CreatePhotoAvatar|CreateDigitalTwinAvatar|DeleteAvatarLook|DeleteAvatarGroup|CreateAvatarLook|CreatePromptAvatar|HeyGenLookStatus|CloneVoice|DeleteVoice|RenameVoice|UpdateVoice)\b/,
  );
});

test("all historical private HeyGen routes are hard 403 defenses", () => {
  const source = read("routes/heygen.ts");

    const mutations = source.match(
      new RegExp(`(?:delete|update)\\(${table}\\)[\\s\\S]*?\\.where\\(([\\s\\S]*?)\\)\\)`, "g"),
    ) ?? [];
  assert.doesNotMatch(
    source,
    /export function use(?:UploadHeyGenAsset|CreatePhotoAvatar|CreateDigitalTwinAvatar|DeleteAvatarLook|DeleteAvatarGroup|CreateAvatarLook|CreatePromptAvatar|HeyGenLookStatus|CloneVoice|DeleteVoice|RenameVoice|UpdateVoice)\b/,
  );
});

test("all historical private HeyGen routes are hard 403 defenses", () => {
  const source = read("routes/heygen.ts");

    const mutations = source.match(
      new RegExp(`(?:delete|update)\\(${table}\\)[\\s\\S]*?\\.where\\(([\\s\\S]*?)\\)\\)`, "g"),
    ) ?? [];
  assert.doesNotMatch(
    source,
    /export function use(?:UploadHeyGenAsset|CreatePhotoAvatar|CreateDigitalTwinAvatar|DeleteAvatarLook|DeleteAvatarGroup|CreateAvatarLook|CreatePromptAvatar|HeyGenLookStatus|CloneVoice|DeleteVoice|RenameVoice|UpdateVoice)\b/,
  );
});

test("all historical private HeyGen routes are hard 403 defenses", () => {
  const source = read("routes/heygen.ts");

    const mutations = source.match(
      new RegExp(`(?:delete|update)\\(${table}\\)[\\s\\S]*?\\.where\\(([\\s\\S]*?)\\)\\)`, "g"),
    ) ?? [];
  assert.doesNotMatch(
    source,
    /export function use(?:UploadHeyGenAsset|CreatePhotoAvatar|CreateDigitalTwinAvatar|DeleteAvatarLook|DeleteAvatarGroup|CreateAvatarLook|CreatePromptAvatar|HeyGenLookStatus|CloneVoice|DeleteVoice|RenameVoice|UpdateVoice)\b/,
  );
});

test("all historical private HeyGen routes are hard 403 defenses", () => {
  const source = read("routes/heygen.ts");

    const mutations = source.match(
      new RegExp(`(?:delete|update)\\(${table}\\)[\\s\\S]*?\\.where\\(([\\s\\S]*?)\\)\\)`, "g"),
    ) ?? [];
  assert.doesNotMatch(
    source,
    /export function use(?:UploadHeyGenAsset|CreatePhotoAvatar|CreateDigitalTwinAvatar|DeleteAvatarLook|DeleteAvatarGroup|CreateAvatarLook|CreatePromptAvatar|HeyGenLookStatus|CloneVoice|DeleteVoice|RenameVoice|UpdateVoice)\b/,
  );
});

test("all historical private HeyGen routes are hard 403 defenses", () => {
  const source = read("routes/heygen.ts");

    const mutations = source.match(
      new RegExp(`(?:delete|update)\\(${table}\\)[\\s\\S]*?\\.where\\(([\\s\\S]*?)\\)\\)`, "g"),
    ) ?? [];
  assert.doesNotMatch(
    source,
    /export function use(?:UploadHeyGenAsset|CreatePhotoAvatar|CreateDigitalTwinAvatar|DeleteAvatarLook|DeleteAvatarGroup|CreateAvatarLook|CreatePromptAvatar|HeyGenLookStatus|CloneVoice|DeleteVoice|RenameVoice|UpdateVoice)\b/,
  );
});

test("all historical private HeyGen routes are hard 403 defenses", () => {
  const source = read("routes/heygen.ts");

    const mutations = source.match(
      new RegExp(`(?:delete|update)\\(${table}\\)[\\s\\S]*?\\.where\\(([\\s\\S]*?)\\)\\)`, "g"),
    ) ?? [];
  const routes = [
    "/heygen/assets",
    "/heygen/avatars/create",
    "/heygen/avatars/create-digital-twin",
    "/heygen/avatars/create-prompt",
    "/heygen/avatars/looks/:lookId/new-look",
    "/heygen/avatars/looks/:lookId",
    "/heygen/avatars/looks/:lookId/status",
    "/heygen/avatars/groups/:groupId",
    "/heygen/voices/clone",
    "/heygen/voices/:voiceId",
  ];
  for (const route of routes) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const handler = source.match(
      new RegExp(`router\\.(?:get|post|patch|delete)\\("${escaped}"[\\s\\S]*?\\n\\}\\);`),
    )?.[0];
    assert.match(
      source,
      new RegExp(`router\\.(?:post|patch|delete)\\("${escaped}"[\\s\\S]*?rejectPrivateHeyGenAction\\(res\\)`),
      `missing 403 defense for ${route}`,
    );
  }
});
