import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function signInDemo(page: Page) {
  await page.goto("/?app=1");
  await page.getByLabel("Email").fill("demo@insightpdf.dev");
  await page.getByLabel("Password").fill("DemoPassword123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "What can I help you understand?" })).toBeVisible();
}

test("recruiter can sign in, inspect seeded documents, and open the PDF viewer", async ({ page }) => {
  await signInDemo(page);
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: /Documents/ }).click();
  await expect(page.locator(".document-card").filter({ hasText: "scanned-project-notes.pdf" })).toBeVisible();
  await page.getByRole("button", { name: "Processing jobs" }).click();
  await expect(page.getByRole("dialog", { name: "Processing jobs" })).toBeVisible();
  await page.locator(".jobs-panel header").getByRole("button", { name: "Close processing jobs" }).click();
  const card = page.locator(".document-card").filter({ hasText: "employee-handbook-v1.pdf" });
  await card.getByRole("button", { name: "Open employee-handbook-v1.pdf" }).click();
  await expect(page.getByRole("dialog", { name: "Preview employee-handbook-v1.pdf" })).toBeVisible();
  await expect(page.locator(".pdf-page-surface canvas")).toBeVisible({ timeout: 30_000 });
});

test("new user can register, upload a real PDF, and wait for indexing", async ({ page, request }) => {
  const demoLogin = await request.post("/api/v1/auth/login", {
    data: { email: "demo@insightpdf.dev", password: "DemoPassword123!" },
  });
  const demo = await demoLogin.json();
  const documentsResponse = await request.get("/api/v1/documents", {
    headers: { Authorization: `Bearer ${demo.access_token}` },
  });
  const documents = await documentsResponse.json();
  const sourceResponse = await request.get(`/api/v1/documents/${documents[0].id}/content`, {
    headers: { Authorization: `Bearer ${demo.access_token}` },
  });
  const sourcePdf = await sourceResponse.body();

  await page.goto("/?app=1");
  await page.getByRole("button", { name: "Need an account? Register" }).click();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.getByLabel("Display name").fill("Playwright User");
  await page.getByLabel("Email").fill(`playwright-${suffix}@example.com`);
  await page.getByLabel("Password").fill("PlaywrightPassword!42");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "What can I help you understand?" })).toBeVisible();

  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: "playwright-upload.pdf",
    mimeType: "application/pdf",
    buffer: sourcePdf,
  });
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: /Documents/ }).click();
  const uploaded = page.locator(".document-card").filter({ hasText: "playwright-upload.pdf" });
  await expect(uploaded).toBeVisible();
  await expect(uploaded.getByText("ready")).toBeVisible({ timeout: 120_000 });
});

test("recruiter can run a background PDF operation and download its result", async ({ page }) => {
  await signInDemo(page);
  await page.getByRole("button", { name: "PDF tools" }).click();
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
  await signInDemo(page);
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: /Documents/ }).click();
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
