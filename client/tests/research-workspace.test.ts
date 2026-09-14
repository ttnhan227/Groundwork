import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

async function readWorkspaceImplementation() {
  const files = await Promise.all([
    readFile(
      new URL(
        "../src/features/workspace/WorkspaceLibrary.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/features/workspace/ResearchWorkspace.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../src/api/client.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../src/features/workspace/WorkspaceApp.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/features/verification/TraceabilityMatrix.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/features/change-log/ReviewFindingsAudit.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/components/layout/TopBar.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/layout/Sidebar.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/features/agent/AgentBottomBar.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../src/i18n/index.ts", import.meta.url), "utf8"),
  ]);
  return files.join("\n");
}

describe("Groundwork document workflow", () => {
  test("offers honest workspace starters and an empty state", async () => {
    const source = await readWorkspaceImplementation();
    expect(source).toContain("Bid responses");
    expect(source).toContain("New Response");
    expect(source).toContain("Search responses");
    expect(source).toContain("Turn a bid pack into a controlled response");
    expect(source).toContain("RFP Response");
    expect(source).toContain("Security Questionnaire");
    expect(source).toContain("Vendor Due Diligence");
    expect(source).toContain("Blank Response");
    expect(source).toContain("Drop an RFP here to start a response");
    expect(source).toContain("No responses yet");
  });

  test("keeps sources, draft, assistant, and review clearly separated", async () => {
    const source = await readWorkspaceImplementation();
    expect(source).toContain("research-workspace-3col");
    expect(source).toContain("SourcesSidebar");
    expect(source).toContain("Response setup");
    expect(source).toContain("Upload the RFP first");
    expect(source).toContain("Nothing to review yet");
    expect(source).toContain("Start blank draft");
    expect(source).toContain("handleCreateNativeDocument");
    expect(source).toContain("window.innerWidth < 1280");
    expect(source).toContain('label: "Assistant"');
    expect(source).toContain('label: "Review"');
    expect(source).toContain('label: "Map"');
    expect(source).toContain('label: "Evidence"');
    expect(source).toContain('placement="side"');
    expect(source).toContain("groundwork-col-tools");
    expect(source).not.toContain("PanelBottomOpen");
    expect(source).toContain("Groundwork AI");
  });

  test("streams progress without presenting hidden reasoning", async () => {
    const source = await readWorkspaceImplementation();
    expect(source).toContain("streamWorkspaceAgent");
    expect(source).toContain("/workspaces/agent/execute");
    expect(source).toContain("onStatus");
    expect(source).toContain("onVerification");
    expect(source).toContain("onArtifact");
    expect(source).not.toContain("Agent Reasoning & Activity Stream");
  });

  test("supports selective sources, inline citations, and reviewable deliverables", async () => {
    const source = await readWorkspaceImplementation();
    expect(source).toContain("toggleSource");
    expect(source).toContain("selectedSourceIds");
    expect(source).toContain("Requirements Traceability Matrix");
    expect(source).toContain("Review findings");
    expect(source).toContain("Unsupported");
    expect(source).toContain("Export response");
  });

  test("protects production editing and navigation workflows", async () => {
    const source = await readWorkspaceImplementation();
    expect(source).toContain("All responses");
    expect(source).toContain("requestedDraftId");
    expect(source).toContain("activeNativeDocumentId");
    expect(source).toContain("Discard unsaved changes?");
    expect(source).toContain("Save or cancel manual edits");
    expect(source).toContain("Before export");
    expect(source).toContain("readinessBlockers");
    expect(source).not.toContain("Studio / Artifacts");
  });

  test("uses real API records instead of fabricated fallback workspaces", async () => {
    const source = await readWorkspaceImplementation();
    expect(source).not.toContain('id: "ws_01"');
    expect(source).not.toContain('id: "doc_01"');
    expect(source).not.toContain("Cloudflare 2026 Form 10-K");
    expect(source).not.toContain("SOX 404 Ready");
    expect(source).toContain("pendingUploadStarted");
    expect(source).toContain('formData.append("file", pendingUpload)');
  });
});
