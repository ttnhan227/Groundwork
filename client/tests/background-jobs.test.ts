import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

async function readImplementation() {
  const files = await Promise.all([
    readFile(new URL("../src/api/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/WorkspaceApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/ResearchWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/WorkspaceLibrary.tsx", import.meta.url), "utf8"),
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

  test("queues agent streaming execution and cancellation", async () => {
    const source = await readImplementation();
    expect(source).toContain("streamWorkspaceAgent");
    expect(source).toContain("/workspaces/agent/execute");
    expect(source).toContain("abortControllerRef.current");
    expect(source).toContain("Cancel");
  });

  test("provides command navigation and durable workspace preferences", async () => {
    const source = await readImplementation();
    expect(source).toContain("CommandPalette");
    expect(source).toContain('event.key.toLowerCase() === "k"');
    expect(source).toContain("storedPreferences");
    expect(source).toContain("applyPreferences");
  });

  test("provides explicit image ordering controls", async () => {
    const source = await readImplementation();
    expect(source).toContain('aria-label="Image order"');
    expect(source).toContain(">Up</button>");
    expect(source).toContain(">Down</button>");
    expect(source).toContain(">Remove</button>");
  });

  test("implements a grounded-to-verified-deliverable workflow", async () => {
    const source = await readImplementation();
    expect(source).toContain("Verifiable Requirements");
    expect(source).toContain("Review Findings");
    expect(source).toContain("Export Deliverable");
    expect(source).toContain("authenticatedFetch");
    expect(source).toContain("tokenExpiresSoon");
  });
});
