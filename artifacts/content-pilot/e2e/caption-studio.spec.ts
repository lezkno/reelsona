import { expect, test, type Page } from "@playwright/test";

type CaptionConfig = Record<string, unknown>;

const INITIAL_CONFIG: CaptionConfig = {
  preset_id: "clean",
  position: "bottom",
  words_per_line: 3,
  primary_color: "#FFFFFF",
  active_word_color: "#FFE600",
  outline_color: "#000000",
  background_color: null,
  font_family: "Poppins",
  font_size: 100,
  line_spacing_factor: 1.1,
  y_position: 82,
  x_position: 50,
  margin_x: 54,
  max_width_percent: 90,
  layout_customized: true,
  active_word_scale: 1,
  highlight_mode: "color",
  auto_scale: false,
  auto_movement: false,
  subtle_rotation: false,
  caption_engine: "browser_experimental",
  template_id: "authority_bold",
  template_overrides: null,
  selected_preset_ids: ["authority_bold", "viral_stack"],
  caption_rotation_strategy: "sequential",
  last_used_preset_id: null,
  preset_usage_count: {},
  updated_at: "2026-08-21T12:00:00.000Z",
};

const AUTOMATION = {
  enabled: false,
  posting_times: ["09:00"],
  days_of_week: [1],
  timezone: "America/Argentina/Buenos_Aires",
  auto_generate_script: false,
  auto_generate_video: false,
  auto_publish: false,
  captions_enabled: true,
  last_run_at: null,
  next_run_at: null,
};

type CaptionStudioApi = {
  config: CaptionConfig;
  captionConfigWrites: CaptionConfig[];
  forbiddenWrites: string[];
};

/**
 * Browser-level API isolation:
 * - simulates an authenticated Pro user;
 * - keeps config changes in test memory, so reload exercises re-hydration;
 * - never contacts the development API, providers, database, or publishing.
 */
async function mockCaptionStudioApi(page: Page): Promise<CaptionStudioApi> {
  const state: CaptionStudioApi = {
    config: structuredClone(INITIAL_CONFIG),
    captionConfigWrites: [],
    forbiddenWrites: [],
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;

    if (method !== "GET" && path !== "/api/captions/config") {
      state.forbiddenWrites.push(`${method} ${path}`);
    }

    if (path === "/api/auth/me") {
      await route.fulfill({
        json: {
          authenticated: true,
          user: { userId: 376, username: "caption-e2e", role: "user", fullName: "Caption E2E" },
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
          credits: { available: 100, subscription: 100, purchased: 0, reserved: 0, totalConsumed: 0 },
          plans: [],
          topups: [],
          founderSeatsLeft: null,
          planCreditsTable: {},
        },
      });
      return;
    }

    if (path === "/api/captions/config") {
      if (method === "PUT") {
        const patch = JSON.parse(request.postData() ?? "{}") as CaptionConfig;
        state.captionConfigWrites.push(patch);
        state.config = { ...state.config, ...patch, updated_at: "2026-08-21T12:00:01.000Z" };
      }
      await route.fulfill({ json: state.config });
      return;
    }

    if (path === "/api/automation") {
      await route.fulfill({ json: AUTOMATION });
      return;
    }

    if (path === "/api/videos") {
      await route.fulfill({ json: [] });
      return;
    }

    if (path === "/api/settings") {
      await route.fulfill({ json: { video_effects: { zoom: false, ai_broll: false, text_cards: false } } });
      return;
    }

    if (path === "/api/captions/presets") {
      await route.fulfill({ json: [] });
      return;
    }

    if (path === "/api/captions/browser/status") {
      await route.fulfill({ json: { available: true } });
      return;
    }

    // Caption Studio's shell can query optional account data. Returning a
    // harmless object ensures the test remains self-contained if that shell
    // gains another read-only query in the future.
    await route.fulfill({ json: {} });
  });

  return state;
}

async function openCaptionStudio(page: Page) {
  await page.goto("/captions");
  await dismissOnboarding(page);
  await expect(page.getByRole("heading", { name: "Studio de Efectos" })).toBeVisible();
  await expect(page.getByText("Captions activados")).toBeVisible();
}

async function dismissOnboarding(page: Page) {
  const onboarding = page.getByRole("dialog", { name: /Reelsona/ });
  if (await onboarding.isVisible()) {
    await onboarding.getByRole("button", { name: "Ahora no" }).click();
  }
}

test("guarda X, Y, ancho y tamaño y los recupera tras recargar", async ({ page }) => {
  const api = await mockCaptionStudioApi(page);
  await openCaptionStudio(page);

  const width = page.getByRole("slider", { name: "Ancho máximo" });
  await width.focus();
  await width.press("Home");
  for (let index = 0; index < 30; index += 1) await width.press("ArrowRight");
  await expect(width).toHaveAttribute("aria-valuenow", "70");

  const xPosition = page.getByRole("slider", { name: "Posición horizontal" });
  await xPosition.focus();
  await xPosition.press("Home");
  for (let index = 0; index < 12; index += 1) await xPosition.press("ArrowRight");
  await expect(xPosition).toHaveAttribute("aria-valuenow", "41");

  const fontSize = page.getByRole("slider", { name: "Tamaño de texto" });
  await fontSize.focus();
  await fontSize.press("Home");
  for (let index = 0; index < 10; index += 1) await fontSize.press("ArrowRight");
  await expect(fontSize).toHaveAttribute("aria-valuenow", "110");

  const yPosition = page.getByRole("slider", { name: "Posición vertical" });
  await yPosition.focus();
  await yPosition.press("End");
  await expect(yPosition).toHaveAttribute("aria-valuenow", "97");

  await page.getByRole("button", { name: "Guardar ajustes" }).click();
  await expect.poll(() => api.captionConfigWrites.length).toBe(1);
  expect(api.captionConfigWrites[0]).toMatchObject({
    x_position: 41,
    y_position: 97,
    max_width_percent: 70,
    font_size: 110,
    layout_customized: true,
  });

  await page.reload();
  await dismissOnboarding(page);
  await expect(page.getByRole("heading", { name: "Studio de Efectos" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Tamaño de texto" })).toHaveAttribute("aria-valuenow", "110");
  await expect(page.getByRole("slider", { name: "Posición horizontal" })).toHaveAttribute("aria-valuenow", "41");
  await expect(page.getByRole("slider", { name: "Posición vertical" })).toHaveAttribute("aria-valuenow", "97");
  await expect(page.getByRole("slider", { name: "Ancho máximo" })).toHaveAttribute("aria-valuenow", "70");
  expect(api.forbiddenWrites).toEqual([]);
});

test("la preview de rotación permite pausar, retroceder y avanzar", async ({ page }) => {
  const api = await mockCaptionStudioApi(page);
  await openCaptionStudio(page);

  const rotationPreview = page.getByText("Preview de rotación:").locator("..");
  await expect(rotationPreview).toContainText("Authority Bold");

  await page.getByRole("button", { name: "Pausar rotación" }).click();
  await expect(page.getByRole("button", { name: "Reanudar rotación" })).toBeVisible();
  await expect(rotationPreview).toContainText("Pausado para inspección");

  await page.getByRole("button", { name: "Plantilla siguiente" }).click();
  await expect(rotationPreview).toContainText("Viral Stack");

  await page.getByRole("button", { name: "Plantilla anterior" }).click();
  await expect(rotationPreview).toContainText("Authority Bold");
  expect(api.forbiddenWrites).toEqual([]);
});