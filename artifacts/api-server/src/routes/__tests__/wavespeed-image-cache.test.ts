import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const clientSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "../../../../../lib/api-client-react/src/custom-endpoints.ts"),
  "utf8",
);

test("WaveSpeed look cache normalizes private object paths after a PATCH", () => {
  assert.match(clientSource, /normalizeWavespeedBrowserImageUrl\(imageUrl: string \| null\)/);
  assert.match(clientSource, /`\/api\/storage\/objects\/\$\{imageUrl\.slice\("\/objects\/"\.length\)\}`/);
});

test("WaveSpeed image normalization leaves browser and external URLs unchanged", () => {
  assert.match(clientSource, /if \(!imageUrl \|\| !imageUrl\.startsWith\("\/objects\/"\)\) return imageUrl/);
  assert.match(clientSource, /imageUrl: normalizeWavespeedBrowserImageUrl\(updatedLook\.imageUrl\)/);
});