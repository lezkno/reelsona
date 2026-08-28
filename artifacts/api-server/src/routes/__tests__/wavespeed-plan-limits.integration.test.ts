import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  contentPlanItemsTable,
  db,
  pool,
  subscriptionsTable,
  userEntitlements,
  users,
  wavespeedLooksTable,
  wavespeedPersonasTable,
  wavespeedVoicesTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { hashPassword } from "../../lib/password.js";
import { invalidateUserPlanCache, isPersonaPlanEnabled } from "../../lib/planLimits.js";

const enabled = process.env.RUN_WAVESPEED_PLAN_LIMITS === "1";
const apiBaseUrl = (process.env.API_TEST_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const password = "WaveSpeedPlan-Test-Only-42";

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
  assert.equal(response.status, 200, `login failed: ${await response.text()}`);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "login did not set a session cookie");
  const cookie = setCookie.split(";")[0];

  return {
    request: (path, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("cookie", cookie);
      return fetch(`${apiBaseUrl}${path}`, { ...init, headers });
    },
  };
}

async function patch(client: SessionClient, path: string, body: Record<string, unknown>): Promise<Response> {
  return client.request(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("effective Basic blocks extra WaveSpeed personas without deleting them", {
  skip: !enabled,
}, async () => {
  const marker = randomUUID().replace(/-/g, "").slice(0, 12);
  const username = `plan-limit-${marker}@test.invalid`;
  let userId: number | undefined;
  let contentItemId: number | undefined;

  try {
    const [user] = await db.insert(users).values({
      username,
      passwordHash: hashPassword(password),
      fullName: "WaveSpeed plan-limit fixture",
      email: username,
      role: "user",
      isActive: true,
      isSuspended: false,
    }).returning({ id: users.id });
    userId = user.id;

    await db.insert(userEntitlements).values({
      userId,
      courseAccess: true,
      toolAccessStatus: "active",
      toolAccessEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      planSlug: "basic",
      source: "wavespeed-plan-limit-test",
    });
    // pendingPlanSlug must not affect the current effective plan.
    await db.insert(subscriptionsTable).values({
      userId,
      planSlug: "basic",
      status: "active",
      pendingPlanSlug: "pro",
    });

    const oldestCreatedAt = new Date("2026-01-01T00:00:00.000Z");
    const newestCreatedAt = new Date("2026-02-01T00:00:00.000Z");
    const [oldest] = await db.insert(wavespeedPersonasTable).values({
      userId,
      name: `Oldest persona ${marker}`,
      createdAt: oldestCreatedAt,
      updatedAt: oldestCreatedAt,
    }).returning();
    const [newest] = await db.insert(wavespeedPersonasTable).values({
      userId,
      name: `Newest persona ${marker}`,
      createdAt: newestCreatedAt,
      updatedAt: newestCreatedAt,
    }).returning();

    const [oldestLook] = await db.insert(wavespeedLooksTable).values({
      userId,
      personaId: oldest.id,
      name: `Oldest look ${marker}`,
      config: JSON.stringify({ generationStatus: "ready", selected: true }),
    }).returning();
    const [newestLook] = await db.insert(wavespeedLooksTable).values({
      userId,
      personaId: newest.id,
      name: `Newest look ${marker}`,
      config: JSON.stringify({ generationStatus: "ready", selected: true }),
    }).returning();
    const [voice] = await db.insert(wavespeedVoicesTable).values({
      userId,
      displayName: `Test voice ${marker}`,
      status: "ready",
      wavespeedVoiceId: `WsVPlanTest${marker}`,
    }).returning();
    const [contentItem] = await db.insert(contentPlanItemsTable).values({
      userId,
      topic: `Plan-limit content ${marker}`,
    }).returning();
    contentItemId = contentItem.id;

    const client = await login(username);

    const listBasic = await client.request("/api/wavespeed/personas");
    assert.equal(listBasic.status, 200);
    const basicBody = await responseJson(listBasic);
    assert.deepEqual(
      basicBody.personas.map((persona: { id: number; planEnabled: boolean }) => ({
        id: persona.id,
        planEnabled: persona.planEnabled,
      })),
      [
        { id: oldest.id, planEnabled: true },
        { id: newest.id, planEnabled: false },
      ],
    );

    // Old UI/API clients cannot select, assign a voice, or finalize the blocked persona.
    const selectBlocked = await patch(client, `/api/wavespeed/looks/${newestLook.id}`, {
      config: { selected: true },
    });
    assert.equal(selectBlocked.status, 403);

    const assignBlocked = await patch(client, `/api/wavespeed/looks/${newestLook.id}`, {
      config: { voiceId: voice.id },
    });
    assert.equal(assignBlocked.status, 403);

    const generateBlocked = await client.request(`/api/wavespeed/personas/${newest.id}/looks/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseLookId: newestLook.id }),
    });
    assert.equal(generateBlocked.status, 403);

    const finalizeBlocked = await client.request(`/api/wavespeed/personas/${newest.id}/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lookIds: [newestLook.id], voiceId: voice.id }),
    });
    assert.equal(finalizeBlocked.status, 403);

    const pinBlocked = await patch(client, `/api/content/${contentItem.id}`, {
      wavespeed_look_id: newestLook.id,
    });
    assert.equal(pinBlocked.status, 403);

    // The records remain intact after all blocked mutations.
    const [lookAfterBlock] = await db
      .select({ id: wavespeedLooksTable.id, config: wavespeedLooksTable.config })
      .from(wavespeedLooksTable)
      .where(and(eq(wavespeedLooksTable.id, newestLook.id), eq(wavespeedLooksTable.userId, userId)));
    assert.equal(lookAfterBlock?.id, newestLook.id);
    assert.equal(lookAfterBlock?.config, JSON.stringify({ generationStatus: "ready", selected: true }));

    // Changing the effective plan to Pro restores the same persona and its look.
    await db.update(subscriptionsTable)
      .set({ planSlug: "pro", pendingPlanSlug: null })
      .where(eq(subscriptionsTable.userId, userId));
    invalidateUserPlanCache(userId);

    assert.equal(await isPersonaPlanEnabled(userId, newest.id), true);
  } finally {
    if (contentItemId !== undefined) {
      await db.delete(contentPlanItemsTable).where(eq(contentPlanItemsTable.id, contentItemId));
    }
    if (userId !== undefined) {
      await db.delete(users).where(eq(users.id, userId));
    }
    await pool.end();
  }
});