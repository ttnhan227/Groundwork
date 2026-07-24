import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the InsightPDF authentication shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>InsightPDF/);
  assert.match(html, /AI-powered PDF workspace/);
  assert.match(html, /Welcome back/);
  assert.match(html, /Sign in/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});

test("includes Phase 3 chat and citation navigation", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /\/conversations/);
  assert.match(page, /Ask InsightPDF/);
  assert.match(page, /citation\.page_number/);
  assert.match(page, /setViewerPage\(citation\.page_number\)/);
  assert.match(page, /ConversationHistory/);
  assert.match(page, /Rename conversation/);
  assert.match(page, /Delete conversation/);
  assert.match(page, /setActiveConversation\(conversation\)/);
  assert.match(page, /Chat history/);
  assert.match(page, /historyDocumentFilter/);
  assert.doesNotMatch(page, /> Conversations<\/button>/);
  assert.match(page, /Document chat history/);
  assert.match(page, /Start new conversation/);
  assert.match(page, /openDocumentChat/);
  assert.match(page, /const latest = saved\.find/);
  assert.match(page, /PdfThumbnail/);
  assert.match(page, /Search PDF/);
  assert.match(page, /Ask multiple PDFs/);
  assert.match(page, /document_ids: selected/);
  assert.match(page, /Your session expired\. Please log in again\./);
  assert.match(page, /response\.status === 401/);
  assert.match(css, /\.chat-panel/);
  assert.match(css, /\.history-panel/);
  assert.match(css, /\.viewer-sidebar/);
  assert.match(css, /\.multi-chat-panel/);
});
