/**
 * Unit tests — pending cloned voice poller core loop.
 *
 * Tests the actual exported `runVoicePollerCycle` function from scheduler.ts
 * using injectable VoicePollerDeps so no real DB or HeyGen key is needed.
 *
 * Run with:
 *   node --import tsx/esm --test src/lib/voice-poller.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runVoicePollerCycle, type VoicePollerDeps } from "./scheduler.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

interface FakeRow {
  id: number;
  userId: number;
  voiceId: string;
  displayName: string;
  createdAt: Date;
}

interface DbUpdate {
  id: number;
  patch: { status: string; voiceId?: string };
}

function makeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 1,
    userId: 42,
    voiceId: "vc_clone_abc123",
    displayName: "Mi voz",
    createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
    ...overrides,
  };
}

function makeDeps(
  rows: FakeRow[],
  getStatus: (id: string) => Promise<{ status: string; voice_id?: string | null; error?: string | null }>,
  overrides: Partial<VoicePollerDeps> = {},
): { deps: VoicePollerDeps; updates: DbUpdate[] } {
  const updates: DbUpdate[] = [];
  const deps: VoicePollerDeps = {
    fetchPending: async () => rows,
    getStatus,
    updateVoice: async (id, patch) => { updates.push({ id, patch }); },
    now: new Date(),
    timeoutMs: 60 * 60 * 1000,
    ...overrides,
  };
  return { deps, updates };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("marks ready when complete and voice_id matches clone_id", async () => {
  const row = makeRow();
  const { deps, updates } = makeDeps([row], async () => ({
    status: "complete",
    voice_id: row.voiceId, // same ID — the common case
  }));

  await runVoicePollerCycle(deps);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, row.id);
  assert.equal(updates[0].patch.status, "ready");
  assert.equal(updates[0].patch.voiceId, row.voiceId);
});

test("marks ready and stores DISTINCT final voice_id when HeyGen promotes the ID", async () => {
  const row = makeRow({ voiceId: "vc_clone_abc123" });
  const finalId = "voice_final_xyz789"; // different from clone_id

  const { deps, updates } = makeDeps([row], async () => ({
    status: "complete",
    voice_id: finalId,
  }));

  await runVoicePollerCycle(deps);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, row.id);
  assert.equal(updates[0].patch.status, "ready");
  assert.equal(
    updates[0].patch.voiceId,
    finalId,
    "final voice_id must overwrite clone_id in DB so generation uses the correct ID",
  );
});

test("marks failed on HeyGen terminal failure status", async () => {
  const row = makeRow();
  const { deps, updates } = makeDeps([row], async () => ({
    status: "failed",
    error: "Audio quality too low",
  }));

  await runVoicePollerCycle(deps);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].patch.status, "failed");
  assert.ok(
    updates[0].patch.voiceId === undefined,
    "voiceId must NOT be set on failure",
  );
});

test("produces no DB update while still processing (within timeout)", async () => {
  const row = makeRow({ createdAt: new Date(Date.now() - 10 * 60 * 1000) }); // 10 min ago
  const { deps, updates } = makeDeps([row], async () => ({ status: "processing" }));

  await runVoicePollerCycle(deps);

  assert.equal(updates.length, 0, "no DB update expected while still processing");
});

test("force-fails a voice that is still processing after 60 minutes", async () => {
  const row = makeRow({
    createdAt: new Date(Date.now() - 61 * 60 * 1000), // 61 min ago
  });
  const { deps, updates } = makeDeps(
    [row],
    async () => ({ status: "processing" }),
    { now: new Date(), timeoutMs: 60 * 60 * 1000 },
  );

  await runVoicePollerCycle(deps);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].patch.status, "failed");
});

test("skips a voice when getStatus throws — does not crash other voices", async () => {
  const rowA = makeRow({ id: 1, voiceId: "vc_a" });
  const rowB = makeRow({ id: 2, voiceId: "vc_b" });

  const { deps, updates } = makeDeps(
    [rowA, rowB],
    async (id) => {
      if (id === "vc_a") throw new Error("Network timeout");
      return { status: "complete", voice_id: "voice_final_b" };
    },
  );

  await runVoicePollerCycle(deps);

  assert.equal(updates.length, 1, "only the successful voice should be updated");
  assert.equal(updates[0].id, 2);
  assert.equal(updates[0].patch.status, "ready");
});

test("handles multiple pending voices independently in one cycle", async () => {
  const rowA = makeRow({ id: 1, voiceId: "vc_a" });
  const rowB = makeRow({ id: 2, voiceId: "vc_b" });
  const rowC = makeRow({ id: 3, voiceId: "vc_c" }); // still processing

  const { deps, updates } = makeDeps(
    [rowA, rowB, rowC],
    async (id) => {
      if (id === "vc_a") return { status: "complete", voice_id: "voice_final_a" };
      if (id === "vc_b") return { status: "failed" };
      return { status: "processing" };
    },
  );

  await runVoicePollerCycle(deps);

  assert.equal(updates.length, 2);
  const aUpdate = updates.find(u => u.id === 1);
  const bUpdate = updates.find(u => u.id === 2);

  assert.ok(aUpdate, "voice A must be updated");
  assert.equal(aUpdate!.patch.status, "ready");
  assert.equal(aUpdate!.patch.voiceId, "voice_final_a");

  assert.ok(bUpdate, "voice B must be updated");
  assert.equal(bUpdate!.patch.status, "failed");
  assert.equal(
    updates.find(u => u.id === 3),
    undefined,
    "voice C (still processing) must NOT be updated",
  );
});
