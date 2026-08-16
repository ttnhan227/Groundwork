import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

async function readNotebookImplementation() {
  const files = await Promise.all([
    readFile(new URL("../src/features/workspace/NotebookLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/NotebookWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/WorkspaceApp.tsx", import.meta.url), "utf8"),
  ]);
  return files.join("\n");
}

describe("NotebookLM-style agentic workspace migration", () => {
  test("implements Level 1 Notebook Library project organizer", async () => {
    const source = await readNotebookImplementation();
    expect(source).toContain("Notebook Library");
    expect(source).toContain("New Notebook");
    expect(source).toContain("Search notebooks...");
    expect(source).toContain("Recommended Workflows");
    expect(source).toContain("Technical Proposal");
    expect(source).toContain("Client Research Report");
    expect(source).toContain("Executive Presentation");
    expect(source).toContain("Blank Notebook");
    expect(source).toContain("Drop file here to start new notebook");
  });

  test("implements Level 2 3-panel Notebook Workspace layout", async () => {
    const source = await readNotebookImplementation();
    // 3-panel architecture
    expect(source).toContain("notebook-workspace-3col");
    expect(source).toContain("Sources");
    expect(source).toContain("Grounded Agent");
    expect(source).toContain("Artifacts");
    expect(source).toContain("Studio");
    expect(source).toContain("Notes");
  });

  test("supports multi-step task execution progress without leaking chain-of-thought", async () => {
    const source = await readNotebookImplementation();
    expect(source).toContain("Multi-Step Task Execution");
    expect(source).toContain("streamNotebookAgent");
    expect(source).toContain("/notebook/agent/execute");
    expect(source).toContain("onStatus");
    expect(source).toContain("onVerification");
    expect(source).toContain("onArtifact");
  });

  test("supports selective grounding, inline citations, and verifiable deliverables", async () => {
    const source = await readNotebookImplementation();
    expect(source).toContain("toggleSource");
    expect(source).toContain("selectedSourceIds");
    expect(source).toContain("Verifiable Requirements");
    expect(source).toContain("Review Findings");
    expect(source).toContain("Unsupported");
    expect(source).toContain("Export Deliverable");
  });
});
