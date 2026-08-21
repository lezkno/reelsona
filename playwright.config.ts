import { defineConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4175);
const baseURL = `http://127.0.0.1:${port}`;

function getSystemChromiumPath(): string | undefined {
  try {
    return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export default defineConfig({
  testDir: "./artifacts/content-pilot/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? getSystemChromiumPath(),
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `PORT=${port} pnpm --filter @workspace/content-pilot run dev`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});