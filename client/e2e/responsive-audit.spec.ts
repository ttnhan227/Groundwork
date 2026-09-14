import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile_375px", width: 375, height: 667 },
  { name: "tablet_768px", width: 768, height: 1024 },
  { name: "desktop_1440px", width: 1440, height: 900 },
];

test.describe("Visual and Responsive Self-Audit across Viewports", () => {
  test("RFP upload card keeps readable contrast in dark mode", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/?app=1");
    await page.getByLabel("Email").fill(process.env.E2E_EMAIL || "admin@groundwork.dev");
    await page.getByLabel("Password").fill(process.env.E2E_PASSWORD || "Admin123456!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator(".groundwork-app-root")).toBeVisible({ timeout: 15_000 });

    if ((await page.locator("html").getAttribute("data-theme")) !== "dark") {
      await page.getByTitle("Toggle color theme").click();
    }

    const card = page.getByTestId("rfp-upload-card");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("rfp-upload-title")).toBeVisible();

    const titleContrast = await card.evaluate((element) => {
      const title = element.querySelector<HTMLElement>("[data-testid='rfp-upload-title']");
      if (!title) return 0;

      const rgb = (value: string) =>
        value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      const luminance = (value: string) => {
        const channels = rgb(value).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.03928
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };

      const foreground = luminance(getComputedStyle(title).color);
      const background = luminance(getComputedStyle(element).backgroundColor);
      return (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05);
    });

    expect(titleContrast).toBeGreaterThanOrEqual(4.5);
  });

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

      // Verify the real product capture is visible and loaded at this viewport.
      const productScreen = page.getByRole("img", {
        name: /Groundwork response workspace/i,
      });
      await expect(productScreen).toBeVisible();
      expect(
        await productScreen.evaluate((image: HTMLImageElement) => image.naturalWidth),
      ).toBe(1440);
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

    });
  }

  for (const vp of [
    { name: "mobile response", width: 375, height: 667, minimumDraftWidth: 250 },
    { name: "compact desktop response", width: 1024, height: 768, minimumDraftWidth: 600 },
  ]) {
    test(`${vp.name} keeps the setup workflow readable`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/?app=1");
      await page.getByRole("button", { name: "Need an account? Register" }).click();
      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await page.locator("input[name='display_name']").fill("Responsive reviewer");
      await page.locator("input[name='email']").fill(`responsive-${suffix}@example.com`);
      await page.locator("input[name='password']").fill("GroundworkResponsive!42");
      await page.getByRole("button", { name: /Create account/i }).click();
      await expect(page.locator(".groundwork-app-root")).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Open response" }).first().click();

      await expect(page.getByRole("button", { name: "All responses" })).toBeVisible();
      await expect(page.getByRole("heading", { name: /Upload the RFP first/i })).toBeVisible();
      const draftBox = await page.locator(".groundwork-col-draft").boundingBox();
      expect(draftBox).not.toBeNull();
      expect(draftBox!.width).toBeGreaterThanOrEqual(vp.minimumDraftWidth);
      expect(await page.locator(".groundwork-col-audit").count()).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
      ).toBe(false);

      await page.getByRole("button", { name: "Open workspace tools" }).click();
      const toolsPanel = page.locator(".groundwork-col-tools");
      await expect(toolsPanel).toBeVisible();
      await expect(page.getByRole("tab", { name: "Assistant" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      const toolsBox = await toolsPanel.boundingBox();
      expect(toolsBox).not.toBeNull();
      expect(toolsBox!.width).toBeLessThanOrEqual(vp.width - 44);
      await toolsPanel
        .getByRole("button", { name: "Collapse workspace tools" })
        .click();
      await expect(toolsPanel).not.toBeVisible();
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
            name: "Proposal review workspace",
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
    await page.getByRole("button", { name: "Lead Engineer", exact: true }).click();

    // Verify Account Settings modal is displayed
    const accountPanel = page.locator(".account-panel-dialog");
    await expect(accountPanel).toBeVisible();

    // Verify Profile tab content
    await expect(page.getByText("Profile & Appearance")).toBeVisible();
    await expect(page.getByText("Google Authentication")).toBeVisible();

    // Navigate to Security tab
    await page.locator(".account-settings-nav button", { hasText: "Security" }).click();
    await expect(page.getByText("Password & Active Sessions")).toBeVisible();

    // Navigate to Response Defaults tab
    await page.locator(".account-settings-nav button", { hasText: "Response Defaults" }).click();
    await expect(page.getByText("Response & Writing Defaults")).toBeVisible();

    // Navigate to Usage tab
    await page.locator(".account-settings-nav button", { hasText: "Usage" }).click();
    await expect(page.getByText("Storage Allocation")).toBeVisible();
    await expect(page.getByText("Pages indexed")).toBeVisible();

    // Close panel
    const closeBtn = page.getByRole("button", { name: "Close account settings" });
    await closeBtn.click();
    await expect(accountPanel).not.toBeVisible();
  });
});
