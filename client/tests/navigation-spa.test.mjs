import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { chromium, expect } from "@playwright/test";

async function startPreviewServer(port) {
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: process.cwd(), windowsHide: true, stdio: "pipe" },
  );

  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) {
      throw new Error("Preview server exited prematurely");
    }
    try {
      await fetch(`http://127.0.0.1:${port}`);
      return server;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  server.kill();
  throw new Error("Timed out waiting for preview server");
}

test("semantic SPA navigation preserves client-side transitions, history, modifier/middle clicks, direct URLs, and focus", async () => {
  const port = 18558;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await startPreviewServer(port);
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    // Stub GitHub releases call on /download to avoid external network dependency
    await page.route(
      "https://api.github.com/repos/ttnhan227/Groundwork/releases?per_page=100",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        }),
    );

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      window.__spaMarker = 42;
    });

    // Verify navbar structure: <nav aria-label="Main"> -> <ul> -> <li> -> <a href>
    const mainNav = page.getByRole("navigation", { name: "Main", exact: true });
    await expect(mainNav).toBeVisible();
    assert.equal(await mainNav.locator("ul > li > a").count(), 6);
    await expect(mainNav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Verify footer nav structure: <nav aria-label="Footer"> -> <ul> -> <li> -> <a href>
    const footerNav = page.getByRole("navigation", { name: "Footer", exact: true });
    await expect(footerNav).toBeVisible();
    assert.equal(await footerNav.locator("ul > li > a").count(), 2);

    // Verify landing page CTA links and announcement link have real hrefs
    const expectedLinks = [
      { locator: page.getByRole("link", { name: "View the roadmap", exact: true }), href: "/about" },
      { locator: page.getByRole("link", { name: "Groundwork home", exact: true }), href: "/" },
      { locator: page.getByRole("link", { name: "Download for Windows", exact: true }), href: "/download" },
      { locator: page.getByRole("link", { name: "See how it works", exact: true }), href: "/docs" },
      { locator: page.getByRole("link", { name: "Explore Agent & Settings", exact: true }), href: "/docs" },
      { locator: page.getByRole("link", { name: "Get Groundwork for Windows", exact: true }), href: "/download" },
      { locator: page.getByRole("link", { name: "macOS roadmap", exact: true }), href: "/about" },
      { locator: footerNav.getByRole("link", { name: "Privacy", exact: true }), href: "/privacy" },
      { locator: footerNav.getByRole("link", { name: "Contact", exact: true }), href: "/contact" },
    ];
    for (const item of expectedLinks) {
      await expect(item.locator).toHaveAttribute("href", item.href);
    }

    // Keyboard Tab + focus-visible outline check on navbar link
    const downloadsLink = mainNav.getByRole("link", { name: "Downloads", exact: true });
    await mainNav.getByRole("link", { name: "Home", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(downloadsLink).toBeFocused();
    const outlineStyle = await downloadsLink.evaluate((el) => {
      const s = getComputedStyle(el);
      return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth };
    });
    assert.notEqual(outlineStyle.outlineStyle, "none");
    assert.notEqual(outlineStyle.outlineWidth, "0px");

    // Keyboard Enter navigates without full page reload
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Download Groundwork", exact: true })).toBeVisible();
    assert.equal(new URL(page.url()).pathname, "/download");
    assert.equal(await page.evaluate(() => window.__spaMarker), 42);
    await expect(downloadsLink).toHaveAttribute("aria-current", "page");

    // Navigate through remaining navbar, footer, and CTA routes without reload
    await mainNav.getByRole("link", { name: "About", exact: true }).click();
    await expect(page.getByRole("heading", { name: "About Groundwork", exact: true })).toBeVisible();

    await mainNav.getByRole("link", { name: "Support", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Contact", exact: true })).toBeVisible();

    await mainNav.getByRole("link", { name: "Resources", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Resources", exact: true })).toBeVisible();

    await mainNav.getByRole("link", { name: "Contributors", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Contributors", exact: true })).toBeVisible();

    await footerNav.getByRole("link", { name: "Privacy", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your PC. Your control.", exact: true })).toBeVisible();

    // Still zero full page reloads
    assert.equal(await page.evaluate(() => window.__spaMarker), 42);

    // Browser Back & Forward navigation
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Contributors", exact: true })).toBeVisible();
    assert.equal(new URL(page.url()).pathname, "/contributors");

    await page.goForward();
    await expect(page.getByRole("heading", { name: "Your PC. Your control.", exact: true })).toBeVisible();
    assert.equal(new URL(page.url()).pathname, "/privacy");

    // Return home via wordmark link without reload
    await page.getByRole("link", { name: "Groundwork home", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Understand your PC\./ })).toBeVisible();
    assert.equal(await page.evaluate(() => window.__spaMarker), 42);

    // Ctrl/Meta-click opens a new tab without navigating the current tab
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    const [ctrlPopup] = await Promise.all([
      context.waitForEvent("page"),
      downloadsLink.click({ modifiers: [modifier] }),
    ]);
    await ctrlPopup.waitForLoadState("domcontentloaded");
    assert.equal(new URL(ctrlPopup.url()).pathname, "/download");
    assert.equal(new URL(page.url()).pathname, "/");
    await ctrlPopup.close();

    // Middle-click opens a new tab without navigating the current tab
    const [middlePopup] = await Promise.all([
      context.waitForEvent("page"),
      mainNav.getByRole("link", { name: "About", exact: true }).click({ button: "middle" }),
    ]);
    await middlePopup.waitForLoadState("domcontentloaded");
    assert.equal(new URL(middlePopup.url()).pathname, "/about");
    assert.equal(new URL(page.url()).pathname, "/");
    await middlePopup.close();

    // Direct URL navigation (including trailing slash) and page refresh
    await page.goto(`${baseUrl}/download/`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Download Groundwork", exact: true })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Download Groundwork", exact: true })).toBeVisible();

    await page.goto(`${baseUrl}/docs/ai`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "AI System Assistant", exact: true })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "AI System Assistant", exact: true })).toBeVisible();

    // Desktop & mobile overflow check
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await expect(mainNav.getByRole("link", { name: "Downloads", exact: true })).toBeVisible();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
    );

    await context.close();
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
});
