const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const {
  chromium,
  expect,
} = require("../../client/node_modules/@playwright/test");

test("first launch, local choice, account recovery, folders and nontechnical settings", async () => {
  const cwd = path.resolve(__dirname, "..");
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "18558",
      "--strictPort",
    ],
    { cwd, windowsHide: true, stdio: "pipe" },
  );
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error("Preview exited");
      try {
        await fetch("http://127.0.0.1:18558");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let signedIn = false,
      loginStatus = 401,
      loginCalls = 0,
      folders = [];
    const serviceUrl = "https://private-service.example.com";
    await page.route("http://127.0.0.1:8000/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (request.method() === "OPTIONS")
        return route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
            "Access-Control-Allow-Headers": "content-type",
          },
        });
      let body = {},
        status = 200;
      if (url.pathname === "/api/sync/status")
        body = {
          enabled: signedIn,
          is_authenticated: signedIn,
          cloud_url: serviceUrl,
          pending_items: 0,
          state: signedIn ? "synced" : "disabled",
        };
      else if (url.pathname === "/api/system/status")
        body = {
          app_version: "0.1.0",
          counts: {
            workspaces: folders.length,
            projects: 0,
            files: 0,
            chunks: 0,
            notes: 0,
          },
        };
      else if (url.pathname === "/api/index/status")
        body = { status: "completed", percent: 100, files_indexed: 0 };
      else if (url.pathname === "/api/workspaces") {
        if (request.method() === "POST") {
          const data = request.postDataJSON();
          folders.push({ id: "folder", ...data });
          body = folders[0];
        } else body = folders;
      } else if (url.pathname === "/api/sync/login") {
        loginCalls++;
        const data = request.postDataJSON();
        assert.equal(
          "url" in data,
          false,
          "UI must not require service configuration",
        );
        status = loginStatus;
        if (status === 200) {
          signedIn = true;
          body = { status: "authenticated" };
        } else body = { detail: "SECRET_INTERNAL_SQL_DIAGNOSTIC" };
      } else if (url.pathname === "/api/sync/logout") {
        signedIn = false;
        body = { status: "local_only" };
      } else if (url.pathname === "/api/sync/trigger")
        body = { status: "success" };
      else if (url.pathname === "/api/system/preferences")
        body = {
          ai_provider: "local",
          cloud_sync_url: serviceUrl,
          openai_api_key_configured: false,
          gemini_api_key_configured: false,
        };
      else if (url.pathname === "/api/ai/providers")
        body = [
          { id: "local", name: "Local passages", is_local: true, active: true },
        ];
      else body = [];
      return route.fulfill({
        status,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(body),
      });
    });
    await page.route("https://**", (route) => route.abort());
    await page.goto("http://127.0.0.1:18558");
    await expect(
      page.getByRole("dialog", { name: "Welcome to Groundwork" }),
    ).toBeVisible();
    const results = path.join(cwd, "test-results");
    fs.mkdirSync(results, { recursive: true });
    await page.screenshot({ path: path.join(results, "polished-welcome.png") });
    await page
      .getByRole("button", { name: "Continue locally", exact: true })
      .click();
    assert.equal(loginCalls, 0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Welcome home." }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.screenshot({ path: path.join(results, "polished-home.png") });
    await page
      .getByRole("button", { name: "Add your first folder", exact: true })
      .click();
    await page.getByLabel("Folder location").pressSequentially("C:/Documents");
    await expect(page.getByLabel("Folder location")).toHaveValue(
      "C:/Documents",
    );
    await page.getByRole("button", { name: "Add folder", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Your folders", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("button", { name: "Sign in with email", exact: true })
      .click();
    await page
      .getByLabel("Account email")
      .pressSequentially("person@example.com");
    await expect(page.getByLabel("Account email")).toHaveValue(
      "person@example.com",
    );
    await page.getByLabel("Account password").fill("a-long-safe-test-password");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "check your email and password",
    );
    assert.ok(
      !(await page.locator("body").innerText()).includes("SECRET_INTERNAL"),
    );
    loginStatus = 200;
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "You're signed in" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Your notes and saved searches are up to date." }),
    ).toBeVisible();
    await page.screenshot({ path: path.join(results, "polished-account.png") });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByLabel("Cloud server URL")).toHaveCount(0);
    assert.ok(!(await page.locator("body").innerText()).includes(serviceUrl));
    await expect(
      page.getByRole("button", { name: "Restart Groundwork engine" }),
    ).not.toBeVisible();
    await page.screenshot({
      path: path.join(results, "polished-settings.png"),
    });
    await page.getByRole("button", { name: "Choose how answers work" }).click();
    await page.getByRole("radio", { name: "OpenAI", exact: true }).check();
    await expect(page.getByLabel("API key")).toBeVisible();
    await expect(page.getByLabel("Model name")).not.toBeVisible();
    await page.screenshot({
      path: path.join(results, "polished-answer-setup.png"),
    });
    await page.setViewportSize({ width: 900, height: 680 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Desktop layout overflows at normal laptop size",
    );
    await page.screenshot({
      path: path.join(results, "polished-small-window.png"),
    });
    assert.deepEqual(errors, []);
    // First launch remains usable even when the local service has not responded.
    await page.evaluate(() =>
      localStorage.removeItem("groundwork-welcome-complete"),
    );
    await page.unroute("http://127.0.0.1:8000/**");
    await page.route("http://127.0.0.1:8000/**", (route) => route.abort());
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Continue locally", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Continue locally", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
});
