import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(__dirname, "..");
const distDir = path.join(clientDir, "dist");
const renderYamlPath = path.resolve(clientDir, "../render.yaml");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".json": "application/json; charset=utf-8",
};

function parseRenderHeaders(yamlText) {
  const headers = [];
  const blockRegex =
    /- path:\s*([^\r\n]+)\r?\n\s+name:\s*([^\r\n]+)\r?\n\s+value:\s*([^\r\n]+)/g;
  for (const match of yamlText.matchAll(blockRegex)) {
    headers.push({
      path: match[1].trim(),
      name: match[2].trim(),
      value: match[3].trim(),
    });
  }
  return headers;
}

function startHeaderInjectedStaticServer(headerRules) {
  const server = http.createServer((req, res) => {
    const reqPath = new URL(req.url || "/", "http://127.0.0.1").pathname;
    let filePath = path.join(distDir, reqPath === "/" ? "index.html" : reqPath);
    if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, "index.html");
    }

    for (const rule of headerRules) {
      if (
        rule.path === "/*" ||
        (rule.path === "/assets/*" && reqPath.startsWith("/assets/"))
      ) {
        res.setHeader(rule.name, rule.value);
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

test("Render CSP and security headers allow all real website routes and self-hosted fonts with zero violations", async () => {
  const yamlText = fs.readFileSync(renderYamlPath, "utf8");
  const headerRules = parseRenderHeaders(yamlText);
  assert.ok(headerRules.some((h) => h.name === "Content-Security-Policy"));
  assert.ok(headerRules.some((h) => h.name === "X-Frame-Options" && h.value === "DENY"));
  assert.ok(headerRules.some((h) => h.name === "X-Content-Type-Options" && h.value === "nosniff"));
  assert.ok(headerRules.some((h) => h.name === "Referrer-Policy"));
  assert.ok(headerRules.some((h) => h.name === "Permissions-Policy"));

  const { server, port } = await startHeaderInjectedStaticServer(headerRules);
  const baseUrl = `http://127.0.0.1:${port}`;
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    const cspViolations = [];
    const pageErrors = [];
    const externalRequests = [];

    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        window.__cspViolations.push({
          violatedDirective: event.violatedDirective,
          blockedURI: event.blockedURI,
        });
      });
    });

    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.origin !== baseUrl && url.protocol !== "blob:" && url.protocol !== "data:") {
        externalRequests.push(req.url());
      }
    });

    // Stub GitHub releases API so /download and /changelog verify real connect-src allowance
    await page.route(
      "https://api.github.com/repos/ttnhan227/Groundwork/releases?per_page=100",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify([
            {
              draft: false,
              prerelease: false,
              tag_name: "v1.1.0",
              assets: [
                {
                  name: "Groundwork-v1.1.0-windows-x64-setup.exe",
                  state: "uploaded",
                  size: 104857600,
                  digest: "sha256:" + "a".repeat(64),
                  browser_download_url:
                    "https://github.com/ttnhan227/Groundwork/releases/download/v1.1.0/Groundwork-v1.1.0-windows-x64-setup.exe",
                },
              ],
            },
          ]),
        }),
    );

    const routes = [
      { path: "/", heading: /Find your files\./ },
      { path: "/download", heading: /Download Groundwork/ },
      { path: "/docs", heading: /Start here/ },
      { path: "/changelog", heading: /What's new/ },
      { path: "/privacy", heading: /Your files\. Your choice\./ },
      { path: "/about", heading: /About Groundwork/ },
      { path: "/resources", heading: /Resources/ },
      { path: "/contributors", heading: /Contributors/ },
      { path: "/contact", heading: /Contact/ },
    ];

    for (const r of routes) {
      await page.goto(`${baseUrl}${r.path}`, { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: r.heading })).toBeVisible();
      const routeViolations = await page.evaluate(() => window.__cspViolations);
      cspViolations.push(...routeViolations.map((v) => ({ route: r.path, ...v })));
    }

    // Confirm self-hosted Inter font loaded and zero third-party font requests occurred
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const loadedFonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts]
        .filter((f) => f.status === "loaded")
        .map((f) => f.family);
    });
    assert.ok(loadedFonts.some((family) => family.includes("Inter")));
    assert.equal(
      externalRequests.filter((u) => /fonts\.googleapis|fonts\.gstatic/i.test(u)).length,
      0,
    );
    assert.deepEqual(
      externalRequests,
      [
        "https://api.github.com/repos/ttnhan227/Groundwork/releases?per_page=100",
        "https://api.github.com/repos/ttnhan227/Groundwork/releases?per_page=100",
      ],
    );
    assert.deepEqual(cspViolations, []);
    assert.deepEqual(pageErrors, []);

    await context.close();
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
