import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile_375px", width: 375, height: 667 },
  { name: "tablet_768px", width: 768, height: 1024 },
  { name: "desktop_1440px", width: 1440, height: 900 },
];

test.describe("Visual and Responsive Self-Audit across Viewports", () => {
  for (const vp of VIEWPORTS) {
    test(`Landing page layout and heading wrapping at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");

      // Verify Brand and Title
      await expect(page.locator("header")).toBeVisible();
      const h1 = page.locator("h1").first();
      await expect(h1).toBeVisible();

      // Check Heading Overflow / Clipping (scrollWidth must not exceed clientWidth)
      const h1Box = await h1.boundingBox();
      expect(h1Box).not.toBeNull();
      expect(h1Box!.width).toBeLessThanOrEqual(vp.width);

      const isH1Overflowing = await h1.evaluate((el) => {
        return el.scrollWidth > el.clientWidth;
      });
      expect(isH1Overflowing).toBe(false);

      // Verify no horizontal document overflow on page
      const docOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(docOverflow).toBe(false);

      // Verify Simulator Card at this viewport
      const simulator = page.locator("#simulator");
      await expect(simulator).toBeVisible();

      // Toggle Simulator States (Blocked -> Resolved)
      const resolveBtn = page.getByRole("button", { name: /2. Resolved State/i });
      await resolveBtn.click();
      await expect(page.getByText("100% Passed")).toBeVisible();

      const blockedBtn = page.getByRole("button", { name: /1. Blocked State/i });
      await blockedBtn.click();
      await expect(page.getByText("83% Blocked")).toBeVisible();

      // Take screenshot artifact for visual audit
      await page.screenshot({
        path: `e2e/screenshots/landing_${vp.name}.png`,
        fullPage: true,
      });
    });

    test(`Authentication screen layout at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/?app=1");

      const authCard = page.locator("main");
      await expect(authCard).toBeVisible();

      // Verify no horizontal overflow
      const docOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(docOverflow).toBe(false);

      await page.screenshot({
        path: `e2e/screenshots/auth_${vp.name}.png`,
      });
    });
  }

  test("User Settings / Account Panel modal layout, tab navigation and responsive design", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Mock backend routes
    await page.route("**/workspaces**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "ws-1",
            name: "Apex Horizon Cloud Modernization Proposal",
            kind: "personal",
            template: "proposal",
            created_at: "2026-08-25T00:00:00Z",
          },
        ]),
      });
    });
    await page.route("**/profile/preferences**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          language: "en",
          theme: "light",
          interface_size: "regular",
          document_language: "English",
          default_tone: "professional",
          citation_style: "inline",
          page_size: "a4",
          default_export_format: "pdf",
          notify_processing_completed: true,
          notify_processing_failed: true,
          notify_comments: true,
          notify_reviews: true,
          retain_activity_history: true,
          retention_days: 90,
        }),
      });
    });
    await page.route("**/profile/sessions**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "sess-1",
            created_at: "2026-08-25T10:00:00Z",
            expires_at: "2026-09-25T10:00:00Z",
          },
        ]),
      });
    });
    await page.route("**/profile/stats**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          workspaces_count: 1,
          documents_count: 5,
          page_count: 42,
          generated_files: 8,
          failed_jobs: 0,
        }),
      });
    });
    await page.route("**/profile/usage**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          storage_bytes: 45000000,
          storage_limit_bytes: 5368709120,
          ai_requests_30_days: 128,
          ai_requests_by_feature: { deliverable_drafting: 84, claim_verification: 44 },
          jobs_by_status: { completed: 18, queued: 0 },
        }),
      });
    });
    await page.route("**/auth/me**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "user-1",
          email: "engineer@example.com",
          display_name: "Lead Engineer",
          role: "admin",
          is_active: true,
          google_linked: true,
        }),
      });
    });
    await page.route("**/members**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
    await page.route("**/documents**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.route("**/notifications/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ unread: 0 }) });
    });

    // Set mock user auth
    await page.goto("/?app=1");
    await page.evaluate(() => {
      const mockAuth = {
        access_token: "mock-test-token",
        refresh_token: "mock-refresh-token",
        user: {
          id: "user-1",
          email: "engineer@groundwork.test",
          display_name: "Lead Engineer",
          role: "admin",
          google_linked: true,
        },
      };
      localStorage.setItem("groundwork-auth", JSON.stringify(mockAuth));
    });
    await page.goto("/?app=1");

    // Open User Settings panel via sidebar settings button or top header avatar
    const settingsBtn = page.getByTitle(/Account profile & (preferences|settings)/i).or(page.getByRole("button", { name: /Settings|Lead Engineer/i })).first();
    await settingsBtn.click();

    // Verify Account Settings modal is displayed
    const accountPanel = page.locator(".account-panel-dialog");
    await expect(accountPanel).toBeVisible();

    // Verify Profile tab content
    await expect(page.getByText("Profile & Appearance")).toBeVisible();
    await expect(page.getByText("Google Authentication")).toBeVisible();

    // Navigate to Security tab
    await page.locator(".account-settings-nav button", { hasText: "Security" }).click();
    await expect(page.getByText("Password & Active Sessions")).toBeVisible();

    // Navigate to Document Defaults tab
    await page.locator(".account-settings-nav button", { hasText: "Document Defaults" }).click();
    await expect(page.getByText("Deliverable & Writing Defaults")).toBeVisible();

    // Navigate to Usage tab
    await page.locator(".account-settings-nav button", { hasText: "Usage" }).click();
    await expect(page.getByText("Storage Allocation")).toBeVisible();
    await expect(page.getByText("Pages indexed")).toBeVisible();

    // Take screenshot of redesigned Account Settings
    await page.screenshot({ path: "e2e/screenshots/user_settings_redesign.png" });

    // Close panel
    const closeBtn = page.getByRole("button", { name: "Close account settings" });
    await closeBtn.click();
    await expect(accountPanel).not.toBeVisible();
  });
});
