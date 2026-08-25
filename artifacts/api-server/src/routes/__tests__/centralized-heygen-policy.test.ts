import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("HeyGen routes do not resolve or persist user API keys", () => {
  const source = read("routes/heygen.ts");
  assert.doesNotMatch(source, /getUserHeyGenKey|settingsTable\.heygenApiKey/);
  assert.match(source, /function getCentralHeyGenKey/);
  assert.match(source, /router\.post\("\/heygen\/account\/connect"[\s\S]*rejectPrivateHeyGenAction/);
  assert.match(source, /router\.post\("\/heygen\/voices\/clone"[\s\S]*rejectPrivateHeyGenAction/);
  assert.match(source, /router\.post\("\/heygen\/avatars\/create"[\s\S]*rejectPrivateHeyGenAction/);
});

test("HeyGen voice catalog excludes cloned voices", () => {
  const source = read("routes/heygen.ts");
  assert.match(source, /const voices = \(await listVoices\(apiKey\)\)\.filter\(\(v\) => !v\.is_clone\)/);
});

test("WaveSpeed look mutations remain user-scoped", () => {
  const source = read("routes/wavespeed.ts");
  assert.match(source, /eq\(wavespeedLooksTable\.id, look\.id\),\s*eq\(wavespeedLooksTable\.userId, userId\)/);
  assert.match(source, /eq\(wavespeedLooksTable\.id, look\.id\),\s*eq\(wavespeedLooksTable\.userId, userId\)/);
});

test("scheduler WaveSpeed mutations carry the owning user id", () => {
  const source = read("lib/scheduler.ts");
  assert.match(
    source,
    /update\(wavespeedPersonasTable\)[\s\S]*?eq\(wavespeedPersonasTable\.id, persona\.id\),[\s\S]*?eq\(wavespeedPersonasTable\.userId, userId\)/,
  );
  assert.match(
    source,
    /update\(wavespeedVoicesTable\)[\s\S]*?eq\(wavespeedVoicesTable\.id, voice\.id\),[\s\S]*?eq\(wavespeedVoicesTable\.userId, voice\.userId\)/,
  );
});

test("Avatars page does not render retired HeyGen private controls", () => {
  const source = fs.readFileSync(
    path.resolve(root, "../../content-pilot/src/pages/Avatars.tsx"),
    "utf8",
  );
  assert.match(source, /\{false && isOwned && deletableLooks\.length > 0/);
  assert.match(source, /\{false && isOwned && looks\.length > 0/);
  assert.doesNotMatch(source, /pendingVideoJob\?\.lookId/);
  assert.doesNotMatch(source, /\{false && showCreation/);
  assert.doesNotMatch(source, /function (NewLookDialog|CloneVoiceDialog|AvatarCreationDialog)\b/);
  assert.doesNotMatch(source, /handle(Delete|Rename|SaveVoiceSpeed|PreviewTuning)Voice/);
});

test("generated client does not export private HeyGen mutations", () => {
  const source = fs.readFileSync(
    path.resolve(root, "../../../lib/api-client-react/src/custom-endpoints.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /export function use(?:UploadHeyGenAsset|CreatePhotoAvatar|CreateDigitalTwinAvatar|DeleteAvatarLook|DeleteAvatarGroup|CreateAvatarLook|CreatePromptAvatar|HeyGenLookStatus|CloneVoice|DeleteVoice|RenameVoice|UpdateVoice)\b/,
  );
});

test("all historical private HeyGen routes are hard 403 defenses", () => {
  const source = read("routes/heygen.ts");
  const routes = [
    "/heygen/assets",
    "/heygen/avatars/create",
    "/heygen/avatars/create-digital-twin",
    "/heygen/avatars/create-prompt",
    "/heygen/avatars/looks/:lookId/new-look",
    "/heygen/avatars/looks/:lookId",
    "/heygen/avatars/groups/:groupId",
    "/heygen/voices/clone",
    "/heygen/voices/:voiceId",
  ];
  for (const route of routes) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      source,
      new RegExp(`router\\.(?:post|patch|delete)\\("${escaped}"[\\s\\S]*?rejectPrivateHeyGenAction\\(res\\)`),
      `missing 403 defense for ${route}`,
    );
  }
});