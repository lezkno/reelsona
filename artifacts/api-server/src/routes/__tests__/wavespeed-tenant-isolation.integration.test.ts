import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool, users, userEntitlements, wavespeedLooksTable, wavespeedPersonasTable, wavespeedVoicesTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { hashPassword } from "../../lib/password.js";

const enabled = process.env.RUN_WAVESPEED_TENANT_ISOLATION === "1";
const apiBaseUrl = (process.env.API_TEST_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const password = "TenantIsolation-Test-Only-42";

type SessionClient = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
};

async function responseJson(response: Response): Promise<any> {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function login(username: string): Promise<SessionClient> {
  const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200, `login failed for ${username}: ${await response.text()}`);

  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, `login did not set a session cookie for ${username}`);
  const cookie = setCookie.split(";")[0];

  return {
    request: (path, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("cookie", cookie);
      return fetch(`${apiBaseUrl}${path}`, { ...init, headers });
    },
  };
}

async function assertNoSensitiveValue(response: Response, sensitiveValues: string[]): Promise<any> {
  const text = await response.text();
  for (const value of sensitiveValues) {
    assert.doesNotMatch(text, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  return text ? JSON.parse(text) : null;
}

test("two authenticated sessions cannot access each other's WaveSpeed data", {
  skip: !enabled,
}, async () => {
  const marker = randomUUID().replace(/-/g, "").slice(0, 12);
  const usernameA = `tenant-a-${marker}@test.invalid`;
  const usernameB = `tenant-b-${marker}@test.invalid`;
  const personaNameA = `Tenant A persona ${marker}`;
  const personaNameB = `Tenant B persona ${marker}`;
  const lookNameA = `Tenant A look ${marker}`;
  const lookNameB = `Tenant B look ${marker}`;
  const voiceNameA = `Tenant A voice ${marker}`;
  const voiceNameB = `Tenant B voice ${marker}`;

  let userIds: number[] = [];
  let clientA: SessionClient | undefined;
  let clientB: SessionClient | undefined;

  try {
    const insertedUsers = await db.insert(users).values([
      {
        username: usernameA,
        passwordHash: hashPassword(password),
        fullName: "Tenant A integration fixture",
        email: usernameA,
        role: "user",
        isActive: true,
        isSuspended: false,
      },
      {
        username: usernameB,
        passwordHash: hashPassword(password),
        fullName: "Tenant B integration fixture",
        email: usernameB,
        role: "user",
        isActive: true,
        isSuspended: false,
      },
    ]).returning({ id: users.id });

    userIds = insertedUsers.map((user) => user.id);
    const [userAId, userBId] = userIds;
    assert.ok(userAId);
    assert.ok(userBId);

    const accessEndsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(userEntitlements).values([
      {
        userId: userAId,
        courseAccess: true,
        toolAccessStatus: "active",
        toolAccessEndsAt: accessEndsAt,
        planSlug: "basic",
        source: "tenant-isolation-test",
      },
      {
        userId: userBId,
        courseAccess: true,
        toolAccessStatus: "active",
        toolAccessEndsAt: accessEndsAt,
        planSlug: "basic",
        source: "tenant-isolation-test",
      },
    ]);

    const [personaA] = await db.insert(wavespeedPersonasTable).values({
      userId: userAId,
      name: personaNameA,
      referenceObjectPath: null,
    }).returning();
    const [personaB] = await db.insert(wavespeedPersonasTable).values({
      userId: userBId,
      name: personaNameB,
      referenceObjectPath: null,
    }).returning();

    const [lookA] = await db.insert(wavespeedLooksTable).values({
      userId: userAId,
      personaId: personaA.id,
      name: lookNameA,
      config: JSON.stringify({ generationStatus: "ready" }),
    }).returning();
    const [lookB] = await db.insert(wavespeedLooksTable).values({
      userId: userBId,
      personaId: personaB.id,
      name: lookNameB,
      config: JSON.stringify({ generationStatus: "ready" }),
    }).returning();

    const [voiceA] = await db.insert(wavespeedVoicesTable).values({
      userId: userAId,
      displayName: voiceNameA,
      status: "ready",
      wavespeedVoiceId: `WsVTestA${marker}`,
      previewAudioUrl: "https://example.invalid/tenant-a-preview.wav",
    }).returning();
    const [voiceB] = await db.insert(wavespeedVoicesTable).values({
      userId: userBId,
      displayName: voiceNameB,
      status: "ready",
      wavespeedVoiceId: `WsVTestB${marker}`,
      previewAudioUrl: "https://example.invalid/tenant-b-preview.wav",
    }).returning();

    clientA = await login(usernameA);
    clientB = await login(usernameB);

    // Collection reads only return the current session's resources.
    const personasForB = await clientB.request("/api/wavespeed/personas");
    assert.equal(personasForB.status, 200);
    const personasBodyB = await assertNoSensitiveValue(personasForB, [personaNameA, lookNameA, voiceNameA]);
    assert.deepEqual(
      personasBodyB.personas.map((persona: { id: number }) => persona.id),
      [personaB.id],
    );

    const voicesForB = await clientB.request("/api/wavespeed/voices");
    assert.equal(voicesForB.status, 200);
    const voicesBodyB = await assertNoSensitiveValue(voicesForB, [personaNameA, lookNameA, voiceNameA]);
    assert.deepEqual(
      voicesBodyB.voices.map((voice: { id: number }) => voice.id),
      [voiceB.id],
    );

    // Resource reads and polling of another user's IDs are safe and reveal nothing.
    const foreignLookStatus = await clientB.request(
      `/api/wavespeed/personas/${personaA.id}/looks/status`,
    );
    assert.equal(foreignLookStatus.status, 200);
    const foreignLookStatusBody = await assertNoSensitiveValue(foreignLookStatus, [
      personaNameA,
      lookNameA,
      voiceNameA,
    ]);
    assert.deepEqual(foreignLookStatusBody, { looks: [], allDone: true });

    for (const path of [
      `/api/wavespeed/voices/${voiceA.id}/status`,
      `/api/wavespeed/voices/${voiceA.id}/play-url`,
      `/api/wavespeed/voices/${voiceA.id}/preview`,
    ]) {
      const response = await clientB.request(path);
      assert.equal(response.status, 404, `foreign read should be hidden: ${path}`);
      await assertNoSensitiveValue(response, [personaNameA, lookNameA, voiceNameA]);
    }

    // Cross-tenant mutations fail before changing the owner's records.
    const patchAttempts: Array<{ path: string; body: Record<string, unknown> }> = [
      { path: `/api/wavespeed/personas/${personaA.id}`, body: { name: "cross-tenant persona edit" } },
      { path: `/api/wavespeed/looks/${lookA.id}`, body: { name: "cross-tenant look edit" } },
      { path: `/api/wavespeed/voices/${voiceA.id}`, body: { speed: 1.2, pitch: 2 } },
    ];
    for (const attempt of patchAttempts) {
      const response = await clientB.request(attempt.path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(attempt.body),
      });
      assert.equal(response.status, 404, `foreign PATCH should be hidden: ${attempt.path}`);
      await assertNoSensitiveValue(response, [personaNameA, lookNameA, voiceNameA]);
    }

    const foreignGenerate = await clientB.request(
      `/api/wavespeed/personas/${personaA.id}/looks/generate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "cross-tenant generation", baseLookId: lookA.id }),
      },
    );
    assert.equal(foreignGenerate.status, 404);
    await assertNoSensitiveValue(foreignGenerate, [personaNameA, lookNameA, voiceNameA]);

    const foreignFinalize = await clientB.request(
      `/api/wavespeed/personas/${personaA.id}/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lookIds: [lookA.id], voiceId: voiceA.id }),
      },
    );
    assert.equal(foreignFinalize.status, 404);
    await assertNoSensitiveValue(foreignFinalize, [personaNameA, lookNameA, voiceNameA]);

    for (const path of [
      `/api/wavespeed/personas/${personaA.id}`,
      `/api/wavespeed/looks/${lookA.id}`,
      `/api/wavespeed/voices/${voiceA.id}`,
    ]) {
      const response = await clientB.request(path, { method: "DELETE" });
      assert.ok([200, 404].includes(response.status), `foreign DELETE should be safe: ${path}`);
      await assertNoSensitiveValue(response, [personaNameA, lookNameA, voiceNameA]);
    }

    const [personaAfter] = await db
      .select({ id: wavespeedPersonasTable.id, name: wavespeedPersonasTable.name })
      .from(wavespeedPersonasTable)
      .where(and(eq(wavespeedPersonasTable.id, personaA.id), eq(wavespeedPersonasTable.userId, userAId)));
    const [lookAfter] = await db
      .select({ id: wavespeedLooksTable.id, name: wavespeedLooksTable.name, config: wavespeedLooksTable.config })
      .from(wavespeedLooksTable)
      .where(and(eq(wavespeedLooksTable.id, lookA.id), eq(wavespeedLooksTable.userId, userAId)));
    const [voiceAfter] = await db
      .select({
        id: wavespeedVoicesTable.id,
        displayName: wavespeedVoicesTable.displayName,
        speed: wavespeedVoicesTable.speed,
        pitch: wavespeedVoicesTable.pitch,
      })
      .from(wavespeedVoicesTable)
      .where(and(eq(wavespeedVoicesTable.id, voiceA.id), eq(wavespeedVoicesTable.userId, userAId)));

    assert.deepEqual(personaAfter, { id: personaA.id, name: personaNameA });
    assert.deepEqual(lookAfter, {
      id: lookA.id,
      name: lookNameA,
      config: JSON.stringify({ generationStatus: "ready" }),
    });
    assert.deepEqual(voiceAfter, {
      id: voiceA.id,
      displayName: voiceNameA,
      speed: null,
      pitch: null,
    });

    // Historical private HeyGen routes stay hard 403s for an authenticated user.
    const heygenPrivateAttempts: Array<{
      method: string;
      path: string;
      body?: RequestInit["body"];
      headers?: RequestInit["headers"];
    }> = [
      {
        method: "POST",
        path: "/api/heygen/account/connect",
        body: JSON.stringify({ apiKey: "not-a-real-key" }),
        headers: { "content-type": "application/json" },
      },
      { method: "DELETE", path: "/api/heygen/account" },
      { method: "GET", path: "/api/heygen/my-avatar-groups" },
      { method: "POST", path: "/api/heygen/assets", body: new FormData() },
      { method: "DELETE", path: `/api/heygen/avatars/looks/${lookA.id}` },
      { method: "DELETE", path: `/api/heygen/avatars/groups/${personaA.id}` },
      {
        method: "POST",
        path: `/api/heygen/avatars/looks/${lookA.id}/new-look`,
        body: JSON.stringify({ name: "blocked", prompt: "blocked", group_id: "blocked" }),
        headers: { "content-type": "application/json" },
      },
      {
        method: "POST",
        path: "/api/heygen/avatars/create-prompt",
        body: JSON.stringify({ name: "blocked", prompt: "blocked" }),
        headers: { "content-type": "application/json" },
      },
      {
        method: "POST",
        path: "/api/heygen/avatars/create",
        body: JSON.stringify({ name: "blocked", asset_id: "blocked" }),
        headers: { "content-type": "application/json" },
      },
      {
        method: "POST",
        path: "/api/heygen/avatars/create-digital-twin",
        body: new FormData(),
      },
      { method: "GET", path: `/api/heygen/avatars/looks/${lookA.id}/status` },
      { method: "POST", path: "/api/heygen/voices/clone", body: new FormData() },
      { method: "DELETE", path: `/api/heygen/voices/${voiceA.id}` },
      {
        method: "PATCH",
        path: `/api/heygen/voices/${voiceA.id}`,
        body: JSON.stringify({ name: "blocked" }),
        headers: { "content-type": "application/json" },
      },
    ];

    for (const attempt of heygenPrivateAttempts) {
      const response = await clientB.request(attempt.path, {
        method: attempt.method,
        body: attempt.body,
        headers: attempt.headers,
      });
      assert.equal(response.status, 403, `private HeyGen route was not blocked: ${attempt.method} ${attempt.path}`);
      await assertNoSensitiveValue(response, [personaNameA, lookNameA, voiceNameA]);
    }
  } finally {
    // Logout removes the temporary session rows when the live server is used.
    await Promise.all([
      clientA?.request("/api/auth/logout", { method: "POST" }).catch(() => {}),
      clientB?.request("/api/auth/logout", { method: "POST" }).catch(() => {}),
    ]);

    if (userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, userIds));
    }
  }
});

test.after(async () => {
  await pool.end();
});