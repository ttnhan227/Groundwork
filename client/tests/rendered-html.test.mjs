import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, "../src");
const distHtml = path.resolve(__dirname, "../dist/index.html");

async function readSourceTree(directory = srcDir) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? readSourceTree(fullPath)
        : /\.(?:ts|tsx)$/.test(entry.name)
          ? readFile(fullPath, "utf8")
          : "";
    }),
  );
  return contents.join("\n");
}

test("builds the Groundwork static website shell", async () => {
  const html = await readFile(distHtml, "utf8");
  assert.match(html, /<title>Groundwork — Windows storage analyzer, duplicate cleaner and hardware inspector<\/title>/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\/assets\/index-/);
});

test("describes local-first system diagnostics and zero legacy document-reader claims", async () => {
  const page = await readSourceTree();
  assert.match(page, /Understand your PC\./);
  assert.match(page, /No account needed/);
  assert.match(page, /27 typed system inspection and proposal tools/);
  assert.match(page, /Windows DPAPI/);
  assert.doesNotMatch(page, /llama\.cpp/i);
  assert.doesNotMatch(page, /\bGGUF\b/);
  assert.doesNotMatch(page, /Google sign-in/i);
  assert.doesNotMatch(page, /Continue locally/);
  assert.doesNotMatch(page, /built-in reader/i);
  assert.doesNotMatch(page, /direct NTFS MFT/i);
  assert.doesNotMatch(page, /recognized image text/i);
});

test("download uses release metadata and states local vs optional AI behavior accurately", async () => {
  const page = await readSourceTree();
  assert.match(page, /fetchWindowsRelease/);
  assert.match(page, /Ollama models are managed separately/);
  assert.doesNotMatch(page, /Groundwork-Setup-1\.0\.0-x64\.msi/);
  assert.match(page, /Windows 10 or 11/);
});

test("organization and operation documentation requires preview and Recycle Bin safety", async () => {
  const page = await readSourceTree();
  assert.match(page, /Scanning never moves or renames your files/);
  assert.match(page, /Applying the exact displayed plan/);
  assert.match(page, /10-step Safe Operation Engine/);
  assert.match(page, /Windows Recycle Bin/);
});

test("hero demo preloads static WebP poster and uses WebM/MP4 with reduced-motion control", async () => {
  const html = await readFile(distHtml, "utf8");
  assert.match(
    html,
    /<link[^>]+rel="preload"[^>]+as="image"[^>]+href="\/groundwork-in-action-poster\.webp"[^>]+fetchpriority="high"/,
  );
  assert.doesNotMatch(html, /as="video"/);

  const source = await readSourceTree();
  assert.match(source, /groundwork-in-action\.webm/);
  assert.match(source, /groundwork-in-action\.mp4/);
  assert.match(source, /groundwork-in-action-poster\.webp/);
  assert.doesNotMatch(source, /\/groundwork-in-action\.gif/);
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
  assert.match(source, /Pause demo/);
  assert.match(source, /Play demo/);
});

test("uses semantic anchor links and list markup for site navigation", async () => {
  const source = await readSourceTree();
  assert.match(source, /<a href=\{to\}/);
  assert.match(source, /aria-label="Main"/);
  assert.match(source, /aria-label="Footer"/);
  assert.match(source, /id="primary-navigation-list"/);
});

test("eliminates third-party font requests and sets document referrer policy", async () => {
  const html = await readFile(distHtml, "utf8");
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
  assert.doesNotMatch(html, /fonts\.gstatic\.com/);
  assert.match(
    html,
    /<meta[^>]+name="referrer"[^>]+content="strict-origin-when-cross-origin"/,
  );
});

test("uses relative rem typography and accessible contrast tokens", async () => {
  const tokensCss = await readFile(
    path.resolve(srcDir, "styles/tokens.css"),
    "utf8",
  );
  assert.match(tokensCss, /--ink-muted:\s*#58616a/);
  assert.match(tokensCss, /--control-border:\s*#7c8999/);
  assert.match(tokensCss, /--text-base:\s*0\.875rem/);
});
