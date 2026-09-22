import { expect, test, type Page } from "@playwright/test";

/**
 * Browser smoke test for the authenticated "Mi Avatar" surface.
 *
 * The session and API responses are intentionally isolated in the browser:
 * this verifies the authenticated UI contract without creating provider data
 * or depending on a particular user's avatars, voices, or subscription.
 */
type AvatarSession = {
  userId: number;
  username: string;
  fullName: string;
  personas: Array<{
    id: number;
    name: string;
    looks: Array<{ id: number; name: string; imageUrl: string | null }>;
  }>;
  voices: Array<{ id: number; displayName: string; status: "ready" }>;
};

async function mockAuthenticatedAvatarApi(page: Page, session: AvatarSession) {
  const forbiddenPrivateHeyGenCalls: string[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;

    if (
      method !== "GET" &&
      !path.startsWith("/api/wavespeed/")
    ) {
      forbiddenPrivateHeyGenCalls.push(`${method} ${path}`);
    }

    if (path === "/api/auth/me") {
      await route.fulfill({
        json: {
          authenticated: true,
          user: {
            userId: session.userId,
            username: session.username,
            role: "user",
            fullName: session.fullName,
          },
        },
      });
      return;
    }

    if (path === "/api/billing") {
      await route.fulfill({
        json: {
          subscription: {
            planSlug: "pro",
            status: "active",
            currentPeriodStart: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            pendingPlanSlug: null,
          },
          credits: {
            available: 100,
            subscription: 100,
            purchased: 0,
            reserved: 0,
            totalConsumed: 0,
          },
          plans: [],
          topups: [],
          founderSeatsLeft: null,
          planCreditsTable: {},
        },
      });
      return;
    }

    if (path === "/api/auth/entitlement") {
      await route.fulfill({ json: { hasAccess: true, status: "active" } });
      return;
    }

    if (path === "/api/credits/balance") {
      await route.fulfill({ json: { balance: 100, reserved: 0 } });
      return;
    }

    if (path === "/api/heygen/avatar-config") {
      await route.fulfill({
        json: {
          selected_avatar_ids: [],
          rotation_strategy: "sequential",
          voice_overrides: {},
        },
      });
      return;
    }

    if (path === "/api/heygen/voices") {
      await route.fulfill({ json: [] });
      return;
    }

    if (path === "/api/heygen/public-avatar-groups") {
      await route.fulfill({ json: { groups: [], next_token: null } });
      return;
    }

    if (path === "/api/wavespeed/personas") {
      await route.fulfill({
        json: { personas: session.personas, planSlug: "pro", planLimit: 3 },
      });
      return;
    }

    if (path === "/api/wavespeed/voices") {
      await route.fulfill({ json: { voices: session.voices } });
      return;
    }

    // Keep the smoke test resilient to harmless shell queries (settings,
    // videos, and optional dashboard data) while failing on private writes.
    await route.fulfill({ json: {} });
  });

  return { forbiddenPrivateHeyGenCalls };
}

async function dismissOnboarding(page: Page) {
  const dismissButton = page.getByText("Ahora no", { exact: true });
  if (await dismissButton.isVisible().catch(() => false)) {
    await dismissButton.click();
  }
}

test("sesión autenticada cubre Mi Avatar, Voces y clonación WaveSpeed", async ({ page }) => {
  const api = await mockAuthenticatedAvatarApi(page, {
    userId: 406,
    username: "avatar-e2e",
    fullName: "Avatar E2E",
    personas: [],
    voices: [],
  });
  await page.goto("/avatars");
  await dismissOnboarding(page);

  await expect(page.getByRole("tab", { name: "Mi Avatar" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Voces" })).toBeVisible();
  await expect(page.getByText("Crea tu Avatar AI")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nuevo Avatar AI" }).first()).toBeVisible();

  await page.getByRole("tab", { name: "Voces" }).click();
  await expect(page.getByText("Clonar mi voz", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Clonar mi voz" }).click();
  const cloneDialog = page.getByRole("dialog", { name: "Clonar mi voz" });
  await expect(cloneDialog).toBeVisible();
  await expect(cloneDialog.getByText("Texto guiado — leé en voz alta")).toBeVisible();
  await expect(cloneDialog.getByRole("button", { name: "Cancelar" })).toBeVisible();

  await cloneDialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(cloneDialog).toBeHidden();

  // These are retired per-user HeyGen controls. The only cloning UI above is
  // the WaveSpeed flow, and no private HeyGen mutation was sent.
  await expect(page.getByText("Conectar cuenta HeyGen", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Crear avatar con HeyGen", { exact: true })).toHaveCount(0);
  expect(api.forbiddenPrivateHeyGenCalls).toEqual([]);
});

test("dos sesiones autenticadas solo reciben sus propios avatares, looks y voces", async ({
  browser,
}) => {
  const sessionA: AvatarSession = {
    userId: 701,
    username: "avatar-user-a",
    fullName: "Avatar User A",
    personas: [{
      id: 7011,
      name: "Persona A",
      looks: [{ id: 7012, name: "Look A", imageUrl: null }],
    }],
    voices: [{ id: 7013, displayName: "Voz A", status: "ready" }],
  };
  const sessionB: AvatarSession = {
    userId: 702,
    username: "avatar-user-b",
    fullName: "Avatar User B",
    personas: [{
      id: 7021,
      name: "Persona B",
      looks: [{ id: 7022, name: "Look B", imageUrl: null }],
    }],
    voices: [{ id: 7023, displayName: "Voz B", status: "ready" }],
  };

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await mockAuthenticatedAvatarApi(pageA, sessionA);
    await mockAuthenticatedAvatarApi(pageB, sessionB);
    await Promise.all([pageA.goto("/avatars"), pageB.goto("/avatars")]);
    await Promise.all([dismissOnboarding(pageA), dismissOnboarding(pageB)]);

    await expect(pageA.getByText("Persona A", { exact: true })).toBeVisible();
    await expect(pageA.getByText("Persona B", { exact: true })).toHaveCount(0);
    await expect(pageB.getByText("Persona B", { exact: true })).toBeVisible();
    await expect(pageB.getByText("Persona A", { exact: true })).toHaveCount(0);

    await pageA.getByRole("tab", { name: "Voces" }).click();
    await pageB.getByRole("tab", { name: "Voces" }).click();
    await expect(pageA.getByText("Voz A", { exact: true })).toBeVisible();
    await expect(pageA.getByText("Voz B", { exact: true })).toHaveCount(0);
    await expect(pageB.getByText("Voz B", { exact: true })).toBeVisible();
    await expect(pageB.getByText("Voz A", { exact: true })).toHaveCount(0);
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
});