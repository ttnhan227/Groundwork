const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const {
  chromium,
  expect,
} = require("../../client/node_modules/@playwright/test");

test("cleanup, installed apps, leftover scanner, and assistant UI polish and layout", async () => {
  const cwd = path.resolve(__dirname, "..");
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "18560",
      "--strictPort",
    ],
    { cwd, windowsHide: true, stdio: "pipe" },
  );
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error("Preview exited");
      try {
        await fetch("http://127.0.0.1:18560");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 820 },
    });
    const errors = [];
    page.on("pageerror", (error) => {
      console.error("PAGEERROR:", error.message, error.stack);
      errors.push(error.message);
    });

    await page.addInitScript(() => {
      localStorage.setItem("groundwork-welcome-complete", "1");
    });

    await page.route("http://127.0.0.1:8000/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "OPTIONS") {
        return route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
            "Access-Control-Allow-Headers": "content-type",
          },
        });
      }
      let body = [];
      if (url.pathname === "/api/workspaces") {
        body = [
          {
            id: "ws-1",
            name: "Downloads & Projects",
            path: "C:/Users/Alex/Downloads",
            is_active: true,
          },
        ];
      } else if (url.pathname.includes("/inventory")) {
        const items =
          url.searchParams.get("kind") === "folder"
            ? []
            : [
                {
                  workspace_id: "ws-1",
                  path: "C:/Users/Alex/Downloads/installer_v2.exe",
                  parent: "C:/Users/Alex/Downloads",
                  name: "installer_v2.exe",
                  kind: "file",
                  extension: ".exe",
                  size_bytes: 157286400,
                  mtime: 1710000000,
                  category: "archives",
                },
              ];
        body = {
          items,
          total: items.length,
          files: 1,
          bytes: 157286400,
          parent_bytes: 157286400,
          category_breakdown: [
            {
              category: "archives",
              label: "Archives",
              file_count: 1,
              size_bytes: 157286400,
              percentage: 100,
            },
          ],
          scan_status: "completed",
          errors: [],
          updated_at: 1,
        };
      } else if (url.pathname === "/api/system/storage-overview") {
        body = {
          total_files: 1420,
          total_bytes: 4831838208,
          workspaces: [
            {
              id: "ws-1",
              name: "Downloads & Projects",
              path: "C:/Users/Alex/Downloads",
              files: 1420,
              bytes: 4831838208,
              scan_status: "completed",
            },
          ],
          drives: [
            {
              path: "C:\\",
              total_bytes: 512110190592,
              free_bytes: 148110190592,
              used_bytes: 364000000000,
              used_percent: 71.1,
            },
          ],
          categories: [
            { category: "archives", count: 42, bytes: 2147483648, share_percent: 44.4 },
            { category: "code", count: 950, bytes: 1610612736, share_percent: 33.3 },
          ],
          largest_files: [
            {
              path: "C:/Users/Alex/Downloads/WinSDK_Installer.iso",
              name: "WinSDK_Installer.iso",
              size_bytes: 1610612736,
              allocated_bytes: 1610612736,
              mtime: 1705000000,
              category: "archives",
              extension: ".iso",
            },
          ],
          largest_folders: [
            {
              path: "C:/Users/Alex/Downloads/BuildCache",
              name: "BuildCache",
              file_count: 812,
              size_bytes: 2147483648,
              share_percent: 44.4,
            },
          ],
          space_map: [
            {
              name: "BuildCache",
              path: "C:/Users/Alex/Downloads/BuildCache",
              kind: "folder",
              size_bytes: 2147483648,
              file_count: 812,
              share_percent: 44.4,
            },
            {
              name: "Installer Archives",
              path: "C:/Users/Alex/Downloads/Archives",
              kind: "folder",
              size_bytes: 1610612736,
              file_count: 24,
              share_percent: 33.3,
            },
            {
              name: "Media Assets",
              path: "C:/Users/Alex/Downloads/Media",
              kind: "folder",
              size_bytes: 1073741824,
              file_count: 68,
              share_percent: 22.3,
            },
          ],
        };
      } else if (url.pathname === "/api/system/cleanup/scan") {
        body = {
          total_reclaimable_bytes: 536870912,
          total_candidates: 2,
          safety_notice:
            "No files are ever deleted automatically. Every cleanup action requires your explicit review and confirmation.",
          rules: [
            {
              id: "exact_duplicates",
              name: "Exact Duplicates (SHA-256)",
              description:
                "Byte-for-byte identical files verified by SHA-256 content hash. Keeps the oldest original copy untouched.",
              safety_level: "safe",
              reclaimable_bytes: 536870912,
              candidate_count: 2,
              items: [
                {
                  path: "C:/Users/Alex/Downloads/report_final (1).pdf",
                  name: "report_final (1).pdf",
                  size_bytes: 268435456,
                  mtime: 1711000000,
                  rule_id: "exact_duplicates",
                  reason: "Exact SHA-256 copy of C:/Users/Alex/Downloads/report_final.pdf",
                  confidence: "high",
                  keep_original: "C:/Users/Alex/Downloads/report_final.pdf",
                  sha256: "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447",
                },
                {
                  path: "C:/Users/Alex/Downloads/archive_backup_copy.zip",
                  name: "archive_backup_copy.zip",
                  size_bytes: 268435456,
                  mtime: 1711000000,
                  rule_id: "exact_duplicates",
                  reason: "Exact SHA-256 copy of C:/Users/Alex/Downloads/archive_backup.zip",
                  confidence: "high",
                  keep_original: "C:/Users/Alex/Downloads/archive_backup.zip",
                  sha256: "b748904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a448",
                },
              ],
            },
            {
              id: "temp_and_logs",
              name: "Temporary, Log & Crash Dump Files",
              description: "Temporary files (.tmp, .bak, .old), crash dumps (.dmp), and rotated logs.",
              safety_level: "safe",
              reclaimable_bytes: 0,
              candidate_count: 0,
              items: [],
            },
          ],
        };
      } else if (url.pathname === "/api/system/cleanup/propose") {
        body = {
          confirmation_required: true,
          confirmation_token: "tok-cleanup-123",
          proposal: {
            action: "cleanup_files",
            mode: "recycle",
            paths: ["C:/Users/Alex/Downloads/report_final (1).pdf"],
            total_bytes: 268435456,
          },
          items: [
            {
              path: "C:/Users/Alex/Downloads/report_final (1).pdf",
              name: "report_final (1).pdf",
              size_bytes: 268435456,
              mtime: 1711000000,
            },
          ],
          skipped: [],
          total_bytes: 268435456,
          item_count: 1,
          mode: "recycle",
          warning: "1 item(s) will be sent to the Windows Recycle Bin.",
        };
      } else if (url.pathname === "/api/system/computer") {
        body = {
          cpu_percent: 18,
          memory_percent: 54,
          memory_total: 17179869184,
          memory_used: 9277129359,
          battery: { percent: 92, plugged_in: true },
          drives: [
            { path: "C:\\", total: 512110190592, free: 148110190592 },
          ],
        };
      } else if (url.pathname === "/api/system/installed-apps") {
        body = {
          supported: true,
          apps: [
            {
              id: "app-vscode",
              name: "Microsoft Visual Studio Code",
              publisher: "Microsoft Corporation",
              version: "1.95.3",
              kind: "Desktop app",
              location: "C:/Users/Alex/AppData/Local/Programs/Microsoft VS Code",
              install_location: "C:/Users/Alex/AppData/Local/Programs/Microsoft VS Code",
              estimated_size_bytes: 498073600,
              install_date: "2026-02-14",
              uninstall_string: "\"C:\\Users\\Alex\\AppData\\Local\\Programs\\Microsoft VS Code\\unins000.exe\"",
              can_uninstall: true,
              can_launch: true,
              description: "Code editing. Redefined.",
              icon: "",
            },
            {
              id: "app-7zip",
              name: "7-Zip 24.08 (x64)",
              publisher: "Igor Pavlov",
              version: "24.08",
              kind: "Desktop app",
              location: "C:/Program Files/7-Zip",
              install_location: "C:/Program Files/7-Zip",
              estimated_size_bytes: 5767168,
              install_date: "2026-01-10",
              uninstall_string: "\"C:\\Program Files\\7-Zip\\Uninstall.exe\"",
              can_uninstall: true,
              can_launch: true,
              description: "File archiver with a high compression ratio.",
              icon: "",
            },
          ],
        };
      } else if (url.pathname === "/api/system/installed-apps/leftovers") {
        body = {
          app_id: "app-vscode",
          app_name: "Microsoft Visual Studio Code",
          publisher: "Microsoft Corporation",
          install_location: "C:/Users/Alex/AppData/Local/Programs/Microsoft VS Code",
          leftovers: [
            {
              path: "C:/Users/Alex/AppData/Roaming/Code/CachedData",
              name: "CachedData",
              kind: "folder",
              location_group: "AppData (Roaming)",
              size_bytes: 142606336,
              file_count: 318,
              mtime: 1711000000,
              confidence: "high",
              evidence: "Exact match in AppData\\Roaming for Microsoft Visual Studio Code",
              safe_to_remove: true,
            },
          ],
          registry_leftovers: [
            {
              key: "HKCU\\Software\\Microsoft\\VSCode",
              hive: "HKCU",
              subkey: "Software\\Microsoft\\VSCode",
              confidence: "high",
              evidence: "User configuration key for VSCode",
              read_only_notice: "Registry keys are shown as read-only evidence.",
            },
          ],
          total_reclaimable_bytes: 142606336,
          high_confidence_bytes: 142606336,
          total_count: 1,
          high_confidence_count: 1,
          review_required_count: 0,
          safety_notice: "Only AppData, ProgramData, and user cache folders are eligible for cleanup.",
        };
      } else if (url.pathname === "/api/ai/providers") {
        body = [{ id: "local", name: "Local passages", is_local: true, active: true }];
      } else if (url.pathname === "/api/system/local-ai") {
        body = {
          supported: true,
          engine_size: 0,
          selected: "",
          loaded: null,
          generating: false,
          hardware: { architecture: "x86_64", ram_total: 17179869184, ram_available: 8589934592, cpu_threads: 8, acceleration: "cpu" },
          models: [],
          download: { phase: "idle", bytes: 0, total: 0, error: null },
        };
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(body),
      });
    });

    const results = path.join(cwd, "test-results");
    fs.mkdirSync(results, { recursive: true });

    await page.goto("http://127.0.0.1:18560");
    await expect(
      page.getByRole("region", { name: "Files and storage workspace" }),
    ).toBeVisible();

    // 1. Navigate to Cleanup view and verify full-workspace layout & controls
    await page.getByRole("button", { name: "Cleanup", exact: true }).click({ timeout: 3000 });
    await expect(
      page.getByRole("heading", { name: "Storage Analyzer & Cleanup" }),
    ).toBeVisible();
    await expect(
      page.getByText("Exact Duplicates (SHA-256)"),
    ).toBeVisible();
    await expect(
      page.getByText("report_final (1).pdf", { exact: true }),
    ).toBeVisible();

    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "Cleanup view must not overflow horizontally",
    );
    await page.screenshot({ path: path.join(results, "polished-cleanup.png") });

    // Select a duplicate candidate and open token-confirmed cleanup modal
    await page.getByText("report_final (1).pdf", { exact: true }).click();
    await page.getByRole("button", { name: /Review & Clean Up/i }).click();
    await expect(
      page.getByRole("dialog", { name: "Confirm File Cleanup" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    // 2. Navigate to Computer (Installed Apps & Uninstaller) view
    await page.getByRole("button", { name: "Computer", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Computer & Installed Apps" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Installed Applications & Uninstaller" }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: /Microsoft Visual Studio Code/i }),
    ).toBeVisible();
    await page.screenshot({ path: path.join(results, "polished-computer.png") });

    // Trigger Leftover scan on selected app
    await page.getByRole("button", { name: /Scan Leftovers/i }).click();
    await expect(
      page.getByText(/Leftover & Footprint Analysis: Microsoft Visual Studio Code/i),
    ).toBeVisible();

    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "Computer view must not overflow horizontally",
    );

    // Check 900x680 laptop viewport overflow on Computer & Cleanup views
    await page.setViewportSize({ width: 900, height: 680 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "Computer view must not overflow at 900x680",
    );

    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
});
