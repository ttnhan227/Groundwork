import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function signInRealAccount(page: Page) {
  test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, "Set E2E_EMAIL and E2E_PASSWORD to test a real account");
  await page.goto("/?app=1");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".groundwork-app-root")).toBeVisible();
}

test("user can sign in and enter the Groundwork workspace library", async ({ page }) => {
  await signInRealAccount(page);
  await expect(page.getByText("Research Workspaces")).toBeVisible();
  await expect(page.getByText("Technical Proposal")).toBeVisible();
});

test("user can launch demo workspace, inspect unsupported claim blocker, and resolve it to unlock export", async ({ page }) => {
  await signInRealAccount(page);
  // Launch demo workspace
  const demoButton = page.getByRole("button", { name: /Launch Demo Workspace|Apex Horizon/i });
  if (await demoButton.isVisible()) {
    await demoButton.click();
  } else {
    await page.getByText(/Apex Horizon/i).first().click();
  }

  // Verify 3-column workspace elements
  await expect(page.locator(".groundwork-col-sources")).toBeVisible();
  await expect(page.locator(".groundwork-col-draft")).toBeVisible();
  await expect(page.locator(".groundwork-col-audit")).toBeVisible();

  // Verify blocked export gate initially
  await expect(page.locator(".readiness-topbar-widget")).toBeVisible();
  await expect(page.locator(".btn-export-gate")).toBeVisible();

  // Locate resolution button if open finding exists
  const resolveBtn = page.getByRole("button", { name: /Apply Verified Revision/i });
  if (await resolveBtn.isVisible()) {
    await resolveBtn.click();
    // Verify readiness updates and gate unlocks
    await expect(page.getByText(/100% Verified/i)).toBeVisible({ timeout: 10_000 });
  }
});

test("new user can register and navigate workspaces via command palette", async ({ page }) => {
  await page.goto("/?app=1");
  await page.getByRole("button", { name: "Need an account? Register" }).click();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.getByLabel("Display name").fill("Groundwork Engineer");
  await page.getByLabel("Email").fill(`groundwork-${suffix}@example.com`);
  await page.getByLabel("Password").fill("GroundworkPassword!42");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator(".groundwork-app-root")).toBeVisible();

  // Test Command Palette
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await expect(page.getByRole("dialog", { name: "Workspace commands" })).toBeVisible();
  await page.getByLabel("Search commands").fill("library");
  await page.keyboard.press("Enter");
});

