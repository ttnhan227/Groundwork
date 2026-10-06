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

test("describes filename browsing separately from readable content", async () => {
  const page = await readSourceTree();
  assert.match(page, /Find files by name or path as they are discovered/);
  assert.match(page, /supported readable formats/);
  assert.match(page, /No\s+account needed/);
});

test("download uses release metadata and discloses separate model downloads", async () => {
  const page = await readSourceTree();
  assert.match(page, /fetchWindowsRelease/);
  assert.match(page, /Local AI models are separate downloads/);
  assert.doesNotMatch(page, /Groundwork-Setup-1\.0\.0-x64\.msi/);
  assert.match(page, /Windows 10 or 11/);
});

test("organization documentation requires preview and reports partial coverage", async () => {
  const page = await readSourceTree();
  assert.match(page, /Scanning never moves or renames your files/);
  assert.match(page, /exact displayed plan/);
  assert.match(page, /Excerpts cover only part of a long document/);
  assert.match(page, /built-in local answers through llama\.cpp/);
});
