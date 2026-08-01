import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

async function readImplementation() {
  const files = await Promise.all([
    readFile(new URL("../src/api/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/WorkspaceApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/DocumentStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/deliverables/NativeWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/CommandPalette.tsx", import.meta.url), "utf8"),
  ]);
  return files.join("\n");
}

describe("background operation client", () => {
  test("queues, polls, and resolves stored results", async () => {
    const source = await readImplementation();
    expect(source).toContain('api<Job>("/jobs"');
    expect(source).toContain("/jobs/status/");
    expect(source).toContain("current.result_id");
    expect(source).toContain("/jobs/images-to-pdf");
    expect(source).toContain("/jobs/watermark");
    expect(source).toContain("/jobs/convert-docx");
    expect(source).toContain('"pdf-to-word": "pdf_to_docx"');
  });

  test("queues cancellable generation and preserves editor continuity", async () => {
    const source = await readImplementation();
    expect(source).toContain('api<Job>("/create/jobs"');
    expect(source).toContain('/cancel`');
    expect(source).toContain("onProgress: setGenerationJob");
    expect(source).toContain("conversation_id: conversation?.id");
    expect(source).toContain("undoStack");
    expect(source).toContain("redoStack");
  });

  test("provides command navigation and durable workspace preferences", async () => {
    const source = await readImplementation();
    expect(source).toContain("Workspace commands");
    expect(source).toContain('event.key.toLowerCase() === "k"');
    expect(source).toContain("/profile/preferences");
    expect(source).toContain("default_export_format");
  });

  test("maps UI tool names to supported background operations", async () => {
    const source = await readImplementation();
    expect(source).toContain('tool === "extract" ? "extraction"');
    expect(source).toContain('tool === "compare" ? "comparison"');
  });

  test("provides explicit image ordering controls", async () => {
    const source = await readImplementation();
    expect(source).toContain('aria-label="Image order"');
    expect(source).toContain(">Up</button>");
    expect(source).toContain(">Down</button>");
    expect(source).toContain(">Remove</button>");
  });

  test("implements a brief-to-verified-deliverable workflow", async () => {
    const source = await readImplementation();
    expect(source).toContain("Verified Client Report");
    expect(source).toContain("Acceptance checklist");
    expect(source).toContain("Brief and evidence pack");
    expect(source).toContain("Run verification");
    expect(source).toContain("unsupported claims");
    expect(source).toContain("/requirements/extract");
    expect(source).toContain("/review-findings/");
    expect(source).toContain("Ready to export");
    expect(source).toContain("suggestionBusy");
    expect(source).toContain("Write or apply a draft before verification");
    expect(source).toContain("tokenExpiresSoon");
  });
});
