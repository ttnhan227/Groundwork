import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

async function readImplementation() {
  const files = await Promise.all([
    readFile(new URL("../src/api/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/WorkspaceApp.tsx", import.meta.url), "utf8"),
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
});
