import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("background operation client", () => {
  test("queues, polls, and resolves stored results", async () => {
    const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
    expect(source).toContain('api<Job>("/jobs"');
    expect(source).toContain("/jobs/status/");
    expect(source).toContain("current.result_id");
    expect(source).toContain("/jobs/images-to-pdf");
    expect(source).toContain("/jobs/watermark");
    expect(source).toContain("/jobs/convert-docx");
    expect(source).toContain('"pdf-to-word": "pdf_to_docx"');
  });

  test("maps UI tool names to supported background operations", async () => {
    const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
    expect(source).toContain('tool === "extract" ? "extraction"');
    expect(source).toContain('tool === "compare" ? "comparison"');
  });

  test("provides explicit image ordering controls", async () => {
    const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
    expect(source).toContain('aria-label="Image order"');
    expect(source).toContain(">Up</button>");
    expect(source).toContain(">Down</button>");
    expect(source).toContain(">Remove</button>");
  });
});
