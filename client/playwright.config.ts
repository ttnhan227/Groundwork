import { defineConfig, devices } from "@playwright/test";

const isExternalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: "./e2e",
  timeout: 150_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080",
    trace: "on-first-retry",
  },
  ...(isExternalServer
    ? {}
    : {
        webServer: {
          command: "npx vite preview --port 8080",
          port: 8080,
          reuseExistingServer: true,
        },
      }),
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        headless: true,
      },
    },
  ],
});
