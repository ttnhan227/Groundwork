import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function signInRealAccount(page: Page) {
  test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, "Set E2E_EMAIL and E2E_PASSWORD to test a real account");
  await page.goto("/?app=1");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "From source files to a finished point of view." })).toBeVisible();
}

test("user can sign in and inspect existing documents", async ({ page }) => {
  await signInRealAccount(page);
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: /Sources/ }).click();
  await expect(page.locator(".document-card").filter({ hasText: "scanned-project-notes.pdf" })).toBeVisible();
  await page.getByRole("button", { name: "Processing jobs" }).click();
  await expect(page.getByRole("dialog", { name: "Processing jobs" })).toBeVisible();
  await page.locator(".jobs-panel header").getByRole("button", { name: "Close processing jobs" }).click();
  const card = page.locator(".document-card").filter({ hasText: "employee-handbook-v1.pdf" });
  await card.getByRole("button", { name: "Open employee-handbook-v1.pdf" }).click();
  await expect(page.getByRole("dialog", { name: "Preview employee-handbook-v1.pdf" })).toBeVisible();
  await expect(page.locator(".pdf-page-surface canvas")).toBeVisible({ timeout: 30_000 });
});

test("new user can register and enter the workspace", async ({ page }) => {
  await page.goto("/?app=1");
  await page.getByRole("button", { name: "Need an account? Register" }).click();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.getByLabel("Display name").fill("Playwright User");
  await page.getByLabel("Email").fill(`playwright-${suffix}@example.com`);
  await page.getByLabel("Password").fill("PlaywrightPassword!42");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "From source files to a finished point of view." })).toBeVisible();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await expect(page.getByRole("dialog", { name: "Workspace commands" })).toBeVisible();
  await page.getByLabel("Search commands").fill("deliverables");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Deliverables" })).toBeVisible();
  await page.getByRole("button", { name: "Create from template" }).click();
  await expect(page.getByRole("heading", { name: "From evidence to a designed deliverable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate from Annual Report" })).toBeVisible();
});

test("workspace command palette navigates between the critical stages", async ({ page }) => {
  await signInRealAccount(page);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await expect(page.getByRole("dialog", { name: "Workspace commands" })).toBeVisible();
  await page.getByLabel("Search commands").fill("source library");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Your evidence, organized." })).toBeVisible();
});

test("recruiter can run a background PDF operation and download its result", async ({ page }) => {
  await signInRealAccount(page);
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: /Sources/ }).click();
  const source = page.locator(".document-card").filter({ hasText: "employee-handbook-v1.pdf" });
  await source.getByRole("button", { name: "More actions for employee-handbook-v1.pdf" }).click();
  await page.getByRole("navigation", { name: "Actions for employee-handbook-v1.pdf" }).getByRole("button", { name: "PDF tools" }).click();
  await expect(page.getByRole("heading", { name: "PDF tools" })).toBeVisible();
  const picker = page.locator(".merge-picker");
  await picker.getByText("employee-handbook-v1.pdf").click();
  await picker.getByText("employee-handbook-v2.pdf").click();
  await page.getByRole("button", { name: "Create file" }).click();
  await expect(page.getByText("Ready to download")).toBeVisible({ timeout: 120_000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  await download;
});

test("live AI flow returns citations and a cached summary", async ({ page }) => {
  test.skip(!process.env.RUN_LIVE_AI_E2E, "Set RUN_LIVE_AI_E2E=1 when a funded LLM is configured");
  await signInRealAccount(page);
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: /Sources/ }).click();
  const card = page.locator(".document-card").filter({ hasText: "employee-handbook-v1.pdf" });
  await card.getByRole("button", { name: "More actions for employee-handbook-v1.pdf" }).click();
  await page.getByRole("navigation", { name: "Actions for employee-handbook-v1.pdf" }).getByRole("button", { name: "Ask AI" }).click();
  const question = page.getByLabel("Question");
  await question.fill("What is the remote work policy?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: /Page 1/ })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Close chat" }).click();
  await card.getByRole("button", { name: "More actions for employee-handbook-v1.pdf" }).click();
  await page.getByRole("navigation", { name: "Actions for employee-handbook-v1.pdf" }).getByRole("button", { name: "AI tools" }).click();
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.locator(".ai-result")).toBeVisible({ timeout: 120_000 });
});

test("user can create, autosave, version, and export a native brief", async ({ page }) => {
  await signInRealAccount(page);
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: /Deliverables/ }).click();
  await page.getByRole("button", { name: "New brief" }).click();
  await expect(page.getByRole("dialog", { name: /Edit Untitled research brief/ })).toBeVisible();
  await page.getByLabel("Document title").fill("Playwright research brief");
  await page.getByLabel("Document content").fill("A grounded finding ready for review.");
  await expect(page.getByText(/saved · revision 2/i)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /Versions/ }).click();
  await expect(page.getByText("Version 2")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  await download;
  await page.getByRole("button", { name: "Close native editor" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Playwright research brief" }).click();
});
