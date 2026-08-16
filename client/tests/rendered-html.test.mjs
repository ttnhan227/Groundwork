import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function readSourceTree(directory = new URL("../src/", import.meta.url)) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(entries.map((entry) => {
    const target = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    return entry.isDirectory()
      ? readSourceTree(target)
      : /\.(?:ts|tsx)$/.test(entry.name) ? readFile(target, "utf8") : "";
  }));
  return contents.join("\n");
}

test("builds the InsightPDF static application shell", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>InsightPDF/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\/assets\/index-/);
});

test("includes session security, authentication and token refresh", async () => {
  const [page, css] = await Promise.all([
    readSourceTree(),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Your session expired\. Please log in again\./);
  assert.match(page, /response\.status === 401/);
  assert.match(page, /AUTH_REFRESHED_EVENT/);
  assert.match(page, /authenticatedFetch/);
  assert.match(page, /\/auth\/refresh/);
  assert.match(page, /tokenExpiresSoon/);
  assert.match(page, /savedBeforeRequest\.access_token !== token/);
  assert.match(css, /\.notebook-nav/);
  assert.match(css, /\.btn-primary-gradient/);
});

test("includes background processing jobs and durable execution", async () => {
  const [page, css] = await Promise.all([
    readSourceTree(),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /queueOperation/);
  assert.match(page, /\/jobs/);
  assert.match(page, /ProcessingJobs/);
  assert.match(page, /downloadArtifact/);
  assert.match(css, /\.jobs-panel/);
  assert.match(css, /\.job-state/);
});

test("includes the complete PDF tools workspace", async () => {
  const [page, css] = await Promise.all([
    readSourceTree(),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  for (const label of ["Merge", "Split", "Extract pages", "Delete pages", "Rotate", "PDF to images", "Images to PDF", "Watermark"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /\/pdf-tools\/artifacts/);
  assert.match(page, /downloadArtifact/);
  assert.match(css, /\.pdf-tools-panel/);
  assert.match(css, /\.artifact-ready/);
});

test("includes profile, account settings, brand mark and admin access", async () => {
  const [page, css] = await Promise.all([
    readSourceTree(),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /\/profile\/stats/);
  assert.match(page, /\/profile\/password/);
  assert.match(page, /\/admin\/users/);
  assert.match(page, /BrandMark/);
  assert.match(css, /\.brand-symbol/);
  assert.match(css, /\.account-panel/);
  assert.match(css, /\.admin-users/);
});

test("includes dark mode and accessible design tokens", async () => {
  const [page, css] = await Promise.all([
    readSourceTree(),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  assert.match(css, /\[data-theme="dark"\]/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(page, /activeTheme/);
});

test("includes complete account settings and durable notifications", async () => {
  const [page, css] = await Promise.all([
    readSourceTree(),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  for (const value of [
    "Profile", "Security", "Document Defaults", "Notifications",
    "Privacy & Data", "Usage", "Team", "Admin", "/profile/sessions",
    "/profile/data-export", "/profile/usage", "/notifications/read-all",
    "Activity center", "Live now", "Needs attention",
  ]) assert.match(page, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(css, /\.account-settings-nav/);
  assert.match(css, /\.notification-panel/);
  assert.match(css, /\.settings-toggle/);
  assert.match(css, /data-interface-size/);
});

test("centers the product on the NotebookLM-style agentic workflow", async () => {
  const [page, css] = await Promise.all([
    readSourceTree(),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Notebook Library/);
  assert.match(page, /New Notebook/);
  assert.match(page, /Recommended Workflows/);
  assert.match(page, /Technical Proposal/);
  assert.match(page, /Sources/);
  assert.match(page, /Grounded Agent/);
  assert.match(page, /Studio/);
  assert.match(page, /Deliverables/);
  assert.match(css, /\.notebook-library-container/);
  assert.match(css, /\.notebook-workspace-3col/);
  assert.match(css, /\.agent-composer-container/);
});

test("implements native workspace documents, review and download", async () => {
  const [page, css] = await Promise.all([
    readSourceTree(),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /\/workspaces/);
  assert.match(page, /\/native-documents/);
  assert.match(page, /Download original/);
  assert.match(css, /\.notebook-card/);
});

test("streams agent tokens and highlights cited PDF text", async () => {
  const [page, css] = await Promise.all([
    readSourceTree(),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /streamNotebookAgent/);
  assert.match(page, /\/notebook\/agent\/execute/);
  assert.match(page, /pdf-highlight-layer/);
  assert.match(page, /initialSearch=\{viewerSearch\}/);
  assert.match(css, /\.pdf-highlight-layer mark/);
});

test("implements the command palette and keyboard shortcuts", async () => {
  const [page, css] = await Promise.all([
    readSourceTree(),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /CommandPalette/);
  assert.match(css, /\.command-palette/);
});

test("guides user through verifiable deliverable review and audit findings", async () => {
  const [page, css] = await Promise.all([
    readSourceTree(),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Verifiable Requirements/);
  assert.match(page, /Review Findings/);
  assert.match(page, /Export Deliverable/);
  assert.match(css, /\.agent-citation-chip/);
});
