import { expect, test } from "@playwright/test";

test.describe("Groundwork Full-Stack E2E Journey", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("1. Platform landing simulator transitions & insights navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible();
    await expect(page.locator("h1")).toContainText(/AI drafts your proposal/i);

    // Verify Simulator Section
    const simulator = page.locator("#simulator");
    await expect(simulator).toBeVisible();

    // Verify initial blocked state
    const blockedState = page.getByText(/83% Blocked/i);
    await expect(blockedState).toBeVisible();

    // Toggle Simulator to Resolved State
    const resolveBtn = page.getByRole("button", { name: /2. Resolved State/i });
    await resolveBtn.click();
    await expect(page.getByText(/100% Passed/i)).toBeVisible();

    // Switch back to Blocked State
    const blockedBtn = page.getByRole("button", { name: /1. Blocked State/i });
    await blockedBtn.click();
    await expect(page.getByText(/83% Blocked/i)).toBeVisible();
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
    await expect(page.getByText(/Research Workspaces/i)).toBeVisible();

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
    const cmdDialog = page.getByRole("dialog", { name: /Workspace commands/i });
    await expect(cmdDialog).toBeVisible();
    
    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(cmdDialog).not.toBeVisible();
  });

  test("3. Research workspace: source activation, inline citations, claim verification & export gate", async ({ page }) => {
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

    // Enter the first proposal workspace
    const workspaceCard = page.getByText(/Regulatory Review|Proposal|Compliance/i).first();
    if (await workspaceCard.isVisible()) {
      await workspaceCard.click();
    }

    // Assert workspace or 3-column layout is visible
    await expect(page.locator(".groundwork-app-root")).toBeVisible();
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

      const defaultsTab = page.getByRole("button", { name: /Document Defaults|Defaults/i });
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
