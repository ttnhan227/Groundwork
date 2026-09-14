import { expect, test } from "@playwright/test";

test.describe("Groundwork Full-Stack E2E Journey", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("1. Landing page explains the workflow and shows the real product", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible();
    await expect(page.locator("h1")).toContainText(/Keep the response defensible/i);

    const productScreen = page.getByRole("img", {
      name: /Groundwork response workspace/i,
    });
    await expect(productScreen).toBeVisible();
    await expect(productScreen).toHaveAttribute("src", "/groundwork-workspace-real.png");
    expect(await productScreen.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1440);
  });

  test("2. User registration, theme persistence, and command palette navigation", async ({ page }) => {
    await page.goto("/?app=1");
    
    // Switch to registration mode
    const registerToggle = page.getByRole("button", { name: /Need an account\? Register/i });
    await expect(registerToggle).toBeVisible();
    await registerToggle.click();

    const timestamp = Date.now();
    const testEmail = `qa-lead-${timestamp}@example.com`;
    const testPassword = "GroundworkSecurityPass#2026";
    const testName = `QA Engineer ${timestamp.toString().slice(-4)}`;

    await page.locator("input[name='display_name']").fill(testName);
    await page.locator("input[name='email']").fill(testEmail);
    await page.locator("input[name='password']").fill(testPassword);
    
    await page.getByRole("button", { name: /Create account/i }).click();

    // Assert successful registration and landing in app root
    await expect(page.locator(".groundwork-app-root")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /Responses \(1\)/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "First RFP response" })).toBeVisible();

    // Test Theme Toggle and Persistence
    const themeBtn = page.getByRole("button", { name: /Toggle light\/dark mode/i });
    if (await themeBtn.isVisible()) {
      const initialTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
      await themeBtn.click();
      const toggledTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
      expect(toggledTheme).not.toBe(initialTheme);
      
      // Reload and assert persistence
      await page.reload();
      await expect(page.locator(".groundwork-app-root")).toBeVisible();
      const persistedTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
      expect(persistedTheme).toBe(toggledTheme);
    }

    // Test Command Palette (Ctrl+K or Meta+K)
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    const cmdDialog = page.getByRole("dialog", { name: /Groundwork commands/i });
    await expect(cmdDialog).toBeVisible();
    
    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(cmdDialog).not.toBeVisible();
  });

  test("3. New user can create and enter an empty review workspace", async ({ page }) => {
    await page.goto("/?app=1");

    // Register a fresh user
    const registerToggle = page.getByRole("button", { name: /Need an account\? Register/i });
    if (await registerToggle.isVisible()) {
      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
      await registerToggle.click();
      await page.locator("input[name='display_name']").fill("FullStack QA Inspector");
      await page.locator("input[name='email']").fill(`qa-studio-${suffix}@example.com`);
      await page.locator("input[name='password']").fill("GroundworkStudioPass#2026");
      await page.getByRole("button", { name: /Create account/i }).click();
      await expect(page.locator(".groundwork-app-root")).toBeVisible({ timeout: 15_000 });
    }

    await page.getByRole("button", { name: "New Response", exact: true }).click();
    await page.getByLabel("Response Name").fill("Source review test");
    await page.getByRole("button", { name: "Create Response" }).last().click();

    await expect(page.locator(".groundwork-col-sources")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".groundwork-col-draft")).toBeVisible();
    await expect(page.locator(".groundwork-col-audit")).toBeVisible();
    const assistantTab = page.getByRole("tab", { name: "Assistant" });
    await expect(assistantTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Ask about this response")).toBeVisible();
    await expect(page.getByLabel("Ask Groundwork AI")).toBeDisabled();
    await page.getByRole("tab", { name: "Review" }).click();
    await expect(page.getByRole("heading", { name: /Upload the RFP first/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Nothing to review yet/i })).toBeVisible();

    await page.getByRole("button", { name: "Start blank draft" }).click();
    await expect(page.getByRole("heading", { name: "Source review test" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit Text" })).toBeVisible();
  });

  test("4. Account Settings Panel tabs and user preferences", async ({ page }) => {
    await page.goto("/?app=1");

    const registerToggle = page.getByRole("button", { name: /Need an account\? Register/i });
    if (await registerToggle.isVisible()) {
      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
      await registerToggle.click();
      await page.locator("input[name='display_name']").fill("Preferences Tester");
      await page.locator("input[name='email']").fill(`qa-pref-${suffix}@example.com`);
      await page.locator("input[name='password']").fill("GroundworkPass#2026");
      await page.getByRole("button", { name: /Create account/i }).click();
      await expect(page.locator(".groundwork-app-root")).toBeVisible({ timeout: 15_000 });
    }

    const settingsBtn = page.getByRole("button", { name: /Settings/i });
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();

      const accountPanel = page.locator(".account-panel-dialog, [role='dialog']").first();
      await expect(accountPanel).toBeVisible();

      const securityTab = page.getByRole("button", { name: /Security/i });
      if (await securityTab.isVisible()) {
        await securityTab.click();
      }

      const defaultsTab = page.getByRole("button", { name: /Response Defaults|Defaults/i });
      if (await defaultsTab.isVisible()) {
        await defaultsTab.click();
      }

      const usageTab = page.getByRole("button", { name: /Usage/i });
      if (await usageTab.isVisible()) {
        await usageTab.click();
      }

      const closeBtn = page.getByRole("button", { name: /Close/i }).first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      }
    }
  });
});
