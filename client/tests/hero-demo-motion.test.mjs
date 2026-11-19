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

test("hero demo supports accessible pause/play, muted inline video, and prefers-reduced-motion across desktop and mobile", async () => {
  const port = 18557;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await startPreviewServer(port);
  let browser;

  try {
    browser = await chromium.launch({ headless: true });

    // 1. Default motion preference on desktop (1280x900)
    const desktopCtx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "no-preference",
    });
    const desktopPage = await desktopCtx.newPage();
    const gifRequests = [];
    desktopPage.on("request", (req) => {
      if (req.url().endsWith(".gif")) gifRequests.push(req.url());
    });

    await desktopPage.goto(baseUrl, { waitUntil: "networkidle" });

    const video = desktopPage.locator(".product-workspace-shot video");
    await expect(video).toBeVisible();
    assert.equal(await video.getAttribute("poster"), "/groundwork-in-action-poster.webp");
    assert.equal(await video.getAttribute("width"), "1000");
    assert.equal(await video.getAttribute("height"), "622");
    await expect(video).toHaveJSProperty("muted", true);
    await expect(video).toHaveJSProperty("loop", true);
    await expect(video).toHaveJSProperty("playsInline", true);
    assert.equal(gifRequests.length, 0);

    const desktopBox = await video.boundingBox();
    assert.ok(desktopBox && desktopBox.width > 600 && desktopBox.height > 350);
    const desktopOverflow = await desktopPage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(desktopOverflow, false);

    // Visible Pause/Play toggle without redundant aria-pressed
    const pauseBtn = desktopPage.getByRole("button", { name: "Pause demo", exact: true });
    await expect(pauseBtn).toBeVisible();
    assert.equal(await pauseBtn.getAttribute("aria-pressed"), null);

    // Keyboard activation (Enter / Space) pauses and resumes playback
    await pauseBtn.focus();
    await desktopPage.keyboard.press("Enter");
    const playBtn = desktopPage.getByRole("button", { name: "Play demo", exact: true });
    await expect(playBtn).toBeVisible();
    await expect(video).toHaveJSProperty("paused", true);

    await desktopPage.keyboard.press("Space");
    await expect(desktopPage.getByRole("button", { name: "Pause demo", exact: true })).toBeVisible();
    await expect(video).toHaveJSProperty("paused", false);

    await desktopCtx.close();

    // 2. Reduced motion preference on mobile (390x844)
    const mobileReducedCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const mobilePage = await mobileReducedCtx.newPage();
    const reducedVideoRequests = [];
    mobilePage.on("request", (req) => {
      if (/\.(webm|mp4|gif)(\?|$)/i.test(req.url())) {
        reducedVideoRequests.push(req.url());
      }
    });

    await mobilePage.goto(baseUrl, { waitUntil: "networkidle" });

    const staticPoster = mobilePage.locator('.product-workspace-shot img[src="/groundwork-in-action-poster.webp"]');
    await expect(staticPoster).toBeVisible();
    assert.equal(await mobilePage.locator(".product-workspace-shot video").count(), 0);
    assert.equal(reducedVideoRequests.length, 0);

    const mobileOverflow = await mobilePage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(mobileOverflow, false);

    const mobilePlayBtn = mobilePage.getByRole("button", { name: "Play demo", exact: true });
    await expect(mobilePlayBtn).toBeVisible();
    const btnBox = await mobilePlayBtn.boundingBox();
    assert.ok(btnBox && btnBox.height >= 36);

    // Explicit user activation plays the video even when reduced motion is enabled
    await mobilePlayBtn.click();
    const mountedVideo = mobilePage.locator(".product-workspace-shot video");
    await expect(mountedVideo).toBeVisible();
    await expect(mobilePage.getByRole("button", { name: "Pause demo", exact: true })).toBeVisible();
    await expect(mountedVideo).toHaveJSProperty("muted", true);

    await mobileReducedCtx.close();
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
});
