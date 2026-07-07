import { defineConfig, devices } from "playwright/test";

const frontendPort = 3001;
const backendPort = 8788;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: [
    {
      name: "backend",
      command: `pnpm --filter backend exec wrangler d1 migrations apply MATCH_DIRECTORY --local && pnpm --filter backend exec wrangler dev --port ${backendPort}`,
      url: `http://127.0.0.1:${backendPort}`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      name: "frontend",
      command: `pnpm --filter frontend exec next build && pnpm --filter frontend exec next start --hostname 127.0.0.1 --port ${frontendPort}`,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${backendPort}`,
      },
      url: `http://127.0.0.1:${frontendPort}`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
