import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function signInRealAccount(page: Page) {
  const email = process.env.E2E_EMAIL || "admin@groundwork.dev";
  const password = process.env.E2E_PASSWORD || "Admin123456!";
  await page.goto("/?app=1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".groundwork-app-root")).toBeVisible({ timeout: 15_000 });
}

test("user can sign in and enter the Groundwork workspace library", async ({ page }) => {
  await signInRealAccount(page);
  await expect(page.getByRole("heading", { name: /Responses \(\d+\)/ })).toBeVisible();
});

test("workspace deletion requires typing the exact workspace name", async ({ page }) => {
  await signInRealAccount(page);
  const workspaceName = `Delete confirmation ${Date.now()}`;

  await page.getByRole("button", { name: "New Response", exact: true }).click();
  await page.getByLabel("Response Name").fill(workspaceName);
  await page.getByRole("button", { name: "Create Response" }).last().click();
  await expect(page.locator(".groundwork-col-sources")).toBeVisible({ timeout: 15_000 });

  await page.goto("/?app=1");
  const workspaceCard = page.locator(".notebook-card", { hasText: workspaceName });
  await expect(workspaceCard).toBeVisible();
  await page.getByRole("button", { name: `Open actions for ${workspaceName}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Delete response workspace?")).toBeVisible();
  const deleteButton = dialog.getByRole("button", { name: "Delete workspace" });
  await expect(deleteButton).toBeDisabled();

  await dialog.getByLabel("Workspace name").fill("wrong name");
  await expect(deleteButton).toBeDisabled();
  await expect(dialog.getByText(/must match exactly/i)).toBeVisible();

  await dialog.getByLabel("Workspace name").fill(workspaceName);
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();

  await expect(dialog).not.toBeVisible();
  await expect(workspaceCard).not.toBeVisible();
});

test("manual response edits are protected before navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?app=1");
  await page.getByRole("button", { name: "Need an account? Register" }).click();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.locator("input[name='display_name']").fill("Response Editor");
  await page.locator("input[name='email']").fill(`editor-${suffix}@example.com`);
  await page.locator("input[name='password']").fill("GroundworkPassword!42");
  await page.getByRole("button", { name: /Create Account/i }).click();
  await expect(page.locator(".groundwork-app-root")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Open response" }).click();
  await page.getByRole("button", { name: "Start blank draft" }).click();
  await expect(page.getByRole("button", { name: "Edit text" })).toBeVisible();
  await expect(page.getByText("Needs mapping")).toBeVisible();

  await page.getByRole("button", { name: "Edit text" }).click();
  await page.locator(".groundwork-col-draft textarea").fill("A manual response edit");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();

  await page.getByRole("button", { name: "All responses" }).click();
  const warning = page.getByRole("dialog");
  await expect(warning.getByText("Discard unsaved changes?")).toBeVisible();
  await warning.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.locator(".groundwork-col-draft textarea")).toHaveValue(
    "A manual response edit",
  );

  await page.getByRole("button", { name: "All responses" }).click();
  await warning.getByRole("button", { name: "Discard and continue" }).click();
  await expect(page.getByRole("heading", { name: /Responses \(\d+\)/ })).toBeVisible();
});

test("new user receives a blank personal workspace and can create another", async ({ page }) => {
  await page.goto("/?app=1");
  await page.getByRole("button", { name: "Need an account? Register" }).click();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.locator("input[name='display_name']").fill("Workflow Auditor");
  await page.locator("input[name='email']").fill(`auditor-${suffix}@example.com`);
  await page.locator("input[name='password']").fill("GroundworkPassword!42");
  await page.getByRole("button", { name: /Create Account/i }).click();
  await expect(page.locator(".groundwork-app-root")).toBeVisible({ timeout: 15_000 });

  await expect(page.getByRole("heading", { name: "First RFP response" })).toBeVisible();
  await page.getByRole("button", { name: "New Response", exact: true }).click();
  await page.getByLabel("Response Name").fill("Client proposal review");
  await page.getByRole("button", { name: "Create Response" }).last().click();

  // Verify 3-column workspace elements
  await expect(page.locator(".groundwork-col-sources")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".groundwork-col-draft")).toBeVisible();
  await expect(page.locator(".groundwork-col-audit")).toBeVisible();

  // Verify review controls are present without seeded findings or claims.
  await expect(page.locator(".readiness-topbar-widget")).toBeVisible();
  await expect(page.locator(".btn-export-gate")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Upload the RFP first/i })).toBeVisible();
  await page.getByRole("tab", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: /Nothing to review yet/i })).toBeVisible();
});

test("new user can register and navigate workspaces via command palette", async ({ page }) => {
  await page.goto("/?app=1");
  await page.getByRole("button", { name: "Need an account? Register" }).click();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.locator("input[name='display_name']").fill("Groundwork Engineer");
  await page.locator("input[name='email']").fill(`groundwork-${suffix}@example.com`);
  await page.locator("input[name='password']").fill("GroundworkPassword!42");
  await page.getByRole("button", { name: /Create Account/i }).click();
  await expect(page.locator(".groundwork-app-root")).toBeVisible({ timeout: 15_000 });

  // Test Command Palette
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await expect(page.getByRole("dialog", { name: "Groundwork commands" })).toBeVisible();
  await page.getByLabel("Search commands").fill("library");
  await page.keyboard.press("Enter");
});
