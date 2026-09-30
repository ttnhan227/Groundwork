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
  assert.match(html, /<title>Groundwork — Find what you were working on<\/title>/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\/assets\/index-/);
});

test("includes local-first headline and developer value proposition", async () => {
  const page = await readSourceTree();
  assert.match(page, /Find what you were/);
  assert.match(page, /Groundwork helps you find, understand, and resume work scattered across your computer/);
  assert.match(page, /Your files/);
  assert.match(page, /The user's workspace belongs to the user's machine/);
});

test("includes desktop download options and system specifications", async () => {
  const page = await readSourceTree();
  assert.match(page, /Download for Windows \(Tauri 2\)/);
  assert.match(page, /Groundwork-Setup-1\.0\.0-x64\.msi/);
  assert.match(page, /Groundwork-1\.0\.0-portable\.exe/);
  assert.match(page, /Windows 10 \(1903\+\) or Windows 11/);
});

test("includes comprehensive documentation sections and privacy manifesto", async () => {
  const page = await readSourceTree();
  assert.match(page, /Universal Search & Hybrid Ranking/);
  assert.match(page, /AI Context Engine & Investigation/);
  assert.match(page, /Groundwork Sync \(Optional Cloud Backend\)/);
  assert.match(page, /Privacy Architecture & Security Model/);
  assert.match(page, /NEVER uploaded/);
});
