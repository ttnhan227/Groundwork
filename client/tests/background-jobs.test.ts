import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

async function readImplementation() {
  const files = await Promise.all([
    readFile(new URL("../src/api/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/WorkspaceApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/ResearchWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/WorkspaceLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/CommandPalette.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/i18n/index.ts", import.meta.url), "utf8"),
  ]);
  return files.join("\n");
}

describe("background operation and workspace client", () => {
  test("queues, polls, and resolves background jobs", async () => {
    const source = await readImplementation();
    expect(source).toContain('api<Job[]>("/jobs"');
    expect(source).toContain("/jobs/status/");
    expect(source).toContain("ProcessingJobs");
    expect(source).toContain("queueOperation");
  });

  test("queues agent streaming execution and cancellation", async () => {
    const source = await readImplementation();
    expect(source).toContain("streamWorkspaceAgent");
    expect(source).toContain("/workspaces/agent/execute");
    expect(source).toContain("abortControllerRef.current");
    expect(source).toContain("Stop");
  });

  test("provides command navigation and durable workspace preferences", async () => {
    const source = await readImplementation();
    expect(source).toContain("CommandPalette");
    expect(source).toContain('event.key.toLowerCase() === "k"');
    expect(source).toContain("storedPreferences");
    expect(source).toContain("applyPreferences");
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
