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

test("landing page meets WCAG contrast, focus visibility, touch targets, root rem scaling, and 320px reflow", async () => {
  const port = 18562;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await startPreviewServer(port);
  let browser;

  try {
    browser = await chromium.launch({ headless: true });

    // 1. Desktop (1280x900) contrast, skip-link, focus-visible, target sizes, and 200% font scaling
    const desktopCtx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await desktopCtx.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // Compute actual WCAG contrast ratios from rendered DOM colors
    const contrastResults = await page.evaluate(() => {
      function parseRgb(str) {
        const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
      }
      function lum([r, g, b]) {
        const [rs, gs, bs] = [r, g, b].map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
      }
      function ratio(c1, c2) {
        const l1 = lum(c1);
        const l2 = lum(c2);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      }
      function effectiveBg(el) {
        let cur = el;
        while (cur) {
          const bg = getComputedStyle(cur).backgroundColor;
          if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
            return parseRgb(bg);
          }
          cur = cur.parentElement;
        }
        return [255, 255, 255];
      }

      const checks = [];
      for (const sel of [
        ".product-showcase .product-eyebrow",
        ".product-workspace-shot figcaption",
        ".product-ai-setup",
        ".product-benefits .product-eyebrow",
        ".product-footer",
      ]) {
        const el = document.querySelector(sel);
        const fg = parseRgb(getComputedStyle(el).color);
        const bg = effectiveBg(el);
        checks.push({ sel, type: "text", ratio: Number(ratio(fg, bg).toFixed(2)) });
      }
      for (const sel of [".site-secondary", ".product-demo-toggle"]) {
        const el = document.querySelector(sel);
        const border = parseRgb(getComputedStyle(el).borderTopColor);
        const selfBg = parseRgb(getComputedStyle(el).backgroundColor);
        const parentBg = effectiveBg(el.parentElement);
        checks.push({
          sel,
          type: "border",
          ratioSelf: Number(ratio(border, selfBg).toFixed(2)),
          ratioParent: Number(ratio(border, parentBg).toFixed(2)),
        });
      }
      return checks;
    });

    for (const c of contrastResults) {
      if (c.type === "text") {
        assert.ok(c.ratio >= 4.5, `${c.sel} text contrast ${c.ratio} < 4.5`);
      } else {
        assert.ok(c.ratioSelf >= 3.0, `${c.sel} border vs self ${c.ratioSelf} < 3.0`);
        assert.ok(c.ratioParent >= 3.0, `${c.sel} border vs parent ${c.ratioParent} < 3.0`);
      }
    }

    // Skip link reveals on first Tab and moves focus to #main-content
    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to content", exact: true });
    await expect(skipLink).toBeFocused();
    const skipBox = await skipLink.boundingBox();
    assert.ok(skipBox && skipBox.y >= 0);
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "main-content");

    // Visible focus outlines on links and buttons (including dark footer link)
    for (const locator of [
      page.getByRole("link", { name: "View the roadmap", exact: true }),
      page.getByRole("button", { name: "Pause demo", exact: true }),
      page.getByRole("link", { name: "Privacy", exact: true }),
    ]) {
      await locator.focus();
      const style = await locator.evaluate((el) => {
        const s = getComputedStyle(el);
        return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
      });
      assert.notEqual(style.style, "none");
      assert.ok(style.width >= 2);
    }

    // Desktop target heights (>= 24px)
    for (const sel of [
      ".product-nav-links a",
      ".product-demo-toggle",
      ".utility-ai-link",
      ".product-roadmap-link",
    ]) {
      const box = await page.locator(sel).first().boundingBox();
      assert.ok(box && box.height >= 24, `${sel} height ${box?.height} < 24`);
    }

    // Root font-size scaling (16px -> 32px / 200%) scales rem-based headings & body copy
    const beforeSizes = await page.evaluate(() => ({
      h1: parseFloat(getComputedStyle(document.querySelector(".product-first-glance h1")).fontSize),
      intro: parseFloat(getComputedStyle(document.querySelector(".product-intro")).fontSize),
      body: parseFloat(getComputedStyle(document.body).fontSize),
    }));
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "32px";
    });
    const afterSizes = await page.evaluate(() => ({
      h1: parseFloat(getComputedStyle(document.querySelector(".product-first-glance h1")).fontSize),
      intro: parseFloat(getComputedStyle(document.querySelector(".product-intro")).fontSize),
      body: parseFloat(getComputedStyle(document.body).fontSize),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    }));
    assert.ok(afterSizes.body >= beforeSizes.body * 1.9);
    assert.ok(afterSizes.intro >= beforeSizes.intro * 1.9);
    assert.ok(afterSizes.h1 > beforeSizes.h1 * 1.3);
    assert.equal(afterSizes.overflow, false);

    await desktopCtx.close();

    // 2. Touch mobile (390x844, hasTouch -> pointer: coarse) touch targets & 320px reflow
    const mobileTouchCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const mobilePage = await mobileTouchCtx.newPage();
    await mobilePage.goto(baseUrl, { waitUntil: "networkidle" });

    const menuBtn = mobilePage.getByRole("button", { name: "Open menu", exact: true });
    const menuBox = await menuBtn.boundingBox();
    assert.ok(menuBox && menuBox.width >= 44 && menuBox.height >= 44);

    await menuBtn.click();
    const firstMobileNavLink = mobilePage
      .getByRole("navigation", { name: "Main", exact: true })
      .getByRole("link")
      .first();
    const navLinkBox = await firstMobileNavLink.boundingBox();
    assert.ok(navLinkBox && navLinkBox.height >= 44);

    const demoToggleBox = await mobilePage.locator(".product-demo-toggle").boundingBox();
    assert.ok(demoToggleBox && demoToggleBox.height >= 44);

    assert.equal(
      await mobilePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
    );

    // 320 CSS px reflow check (WCAG 1.4.10)
    await mobilePage.setViewportSize({ width: 320, height: 568 });
    assert.equal(
      await mobilePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
    );

    await mobileTouchCtx.close();
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
});
