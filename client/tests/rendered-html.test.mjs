import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("builds the InsightPDF static application shell", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>InsightPDF/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\/assets\/index-/);
});

test("includes Phase 3 chat and citation navigation", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
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
  assert.doesNotMatch(page, /historyDocumentFilter/);
  assert.doesNotMatch(page, /> Conversations<\/button>/);
  assert.match(page, /Workspace chat history/);
  assert.match(page, /Start new conversation/);
  assert.match(page, /openDocumentChat/);
  assert.doesNotMatch(page, /const latest = saved\.find/);
  assert.match(page, /attachedDocuments\.map/);
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

test("includes Phase 4 document intelligence tools", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /AI tools/);
  assert.match(page, /Compare PDFs/);
  assert.match(page, /Summarize/);
  assert.match(page, /Translate/);
  assert.match(page, /queueOperation/);
  assert.match(page, /\/jobs/);
  assert.match(page, /\/ai\/results/);
  assert.match(page, /Download translation/);
  assert.match(css, /\.ai-workspace/);
  assert.match(css, /\.quiz-question/);
});

test("includes the complete Phase 5 PDF tools workspace", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
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

test("includes Phase 6 dashboard, account, and admin access", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /\/profile\/stats/);
  assert.match(page, /\/profile\/password/);
  assert.match(page, /\/admin\/users/);
  assert.match(page, /Search titles, filenames, and tags/);
  assert.match(page, /What can I help you understand\?/);
  assert.match(page, /Save source images to workspace/);
  assert.match(page, /function BrandMark/);
  assert.match(css, /\.brand-symbol/);
  assert.match(page, /retryDocument/);
  assert.match(css, /\.dashboard-cards/);
  assert.match(css, /\.hub-sidebar/);
  assert.match(css, /\.hub-conversation/);
  assert.match(css, /\.hub-quick-tools/);
  assert.match(css, /\.account-panel/);
  assert.match(css, /\.admin-users/);
});

test("includes the Version 2.5 AI-first workspace experience", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  for (const value of [
    "Drop a PDF here to begin",
    "starterPrompts",
    "followUpPrompts",
    "Export conversation",
    "Search within document",
    "Generate title & tags",
    "/collections",
    "Recent activity",
    "Message InsightPDF AI",
    "Keyboard shortcuts",
  ]) assert.match(page, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(css, /\.ai-upload-dropzone/);
  assert.match(css, /\.collection-bar/);
  assert.doesNotMatch(css, /\[data-theme="dark"\]/);
  assert.doesNotMatch(page, /Toggle dark mode/);
  assert.match(css, /prefers-reduced-motion/);
});

test("streams chat tokens and highlights cited PDF text", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /messages\/stream/);
  assert.match(page, /Accept: "text\/event-stream"/);
  assert.match(page, /response\.body\.getReader\(\)/);
  assert.match(page, /event === "token"/);
  assert.match(page, /event === "complete"/);
  assert.match(page, /getTextContent\(\)/);
  assert.match(page, /pdf-highlight-layer/);
  assert.match(page, /initialSearch=\{viewerSearch\}/);
  assert.match(css, /\.pdf-highlight-layer mark/);
  assert.match(css, /citation-pulse/);
});
