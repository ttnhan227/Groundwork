import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 150_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8099",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npx vite preview --port 8099",
    port: 8099,
    reuseExistingServer: false,
  },
  projects: [{
    name: "chromium",
    use: { ...devices["Desktop Chrome"], ...(process.env.CI ? {} : { channel: "chrome" }) },
  }],
});
