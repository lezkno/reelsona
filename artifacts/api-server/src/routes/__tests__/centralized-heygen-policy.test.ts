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
});