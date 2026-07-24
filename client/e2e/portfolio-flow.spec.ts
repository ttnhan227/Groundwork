import { expect, test } from "@playwright/test";

test("recruiter can sign into the seeded demo and open PDF tools", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Portfolio demo")).toBeVisible();
  await page.getByLabel("Email").fill("demo@insightpdf.dev");
  await page.getByLabel("Password").fill("DemoPassword123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your PDFs" })).toBeVisible();
  await expect(page.getByText("employee-handbook-v1.pdf")).toBeVisible();
  await expect(page.getByText("scanned-project-notes.pdf")).toBeVisible();
  await page.getByRole("button", { name: "PDF tools" }).click();
  await expect(page.getByRole("heading", { name: "PDF tools" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Merge" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Watermark" })).toBeVisible();
});
