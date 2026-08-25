import { expect, test, type Page } from "@playwright/test";

/**
 * Browser smoke test for the authenticated "Mi Avatar" surface.
 *
 * The session and API responses are intentionally isolated in the browser:
 * this verifies the authenticated UI contract without creating provider data
 * or depending on a particular user's avatars, voices, or subscription.
 */
async function mockAuthenticatedAvatarApi(page: Page) {
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
            userId: 406,
            username: "avatar-e2e",
            role: "user",
            fullName: "Avatar E2E",
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
        json: { personas: [], planSlug: "pro", planLimit: 3 },
      });
      return;
    }

    if (path === "/api/wavespeed/voices") {
      await route.fulfill({ json: { voices: [] } });
      return;
    }

    // Keep the smoke test resilient to harmless shell queries (settings,
    // videos, and optional dashboard data) while failing on private writes.
    await route.fulfill({ json: {} });
  });

  return { forbiddenPrivateHeyGenCalls };
}

async function dismissOnboarding(page: Page) {
  const onboarding = page.getByRole("dialog", { name: /Reelsona/i });
  if (await onboarding.isVisible().catch(() => false)) {
    await onboarding.getByRole("button", { name: "Ahora no" }).click();
  }
}

test("sesión autenticada cubre Mi Avatar, Voces y clonación WaveSpeed", async ({ page }) => {
  const api = await mockAuthenticatedAvatarApi(page);
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