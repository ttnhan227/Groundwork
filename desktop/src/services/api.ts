import type {
  ActivityItem,
  AIQueryResponse,
  ContextSession,
  IndexProgress,
  Note,
  Project,
  ProjectOverview,
  SavedSearch,
  SearchResponse,
  SystemStatus,
  Workspace,
} from "../types/api";

import { invoke, isTauri } from "@tauri-apps/api/core";

export interface InstalledApp {
  id: string; name: string; icon: string; publisher: string; version: string;
  description: string; location: string; kind: string;
}

let connectionPromise: Promise<{ url: string; token?: string }> | undefined;
function getConnection() {
  if (!connectionPromise) {
    connectionPromise = isTauri()
      ? invoke<{ url: string; token: string }>("start_local_core").catch(() => {
          connectionPromise = undefined;
          throw new Error(
            "Groundwork couldn't start. Please close the app and open it again.",
          );
        })
      : Promise.resolve({ url: "http://127.0.0.1:8000" });
  }
  return connectionPromise;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const connection = await getConnection();
  const url = `${connection.url}${path}`;
  const res = await fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      ...(connection.token
        ? { Authorization: `Bearer ${connection.token}` }
        : {}),
      ...(options.headers || {}),
    },
  }).catch(() => {
    if (isTauri()) connectionPromise = undefined;
    throw new Error(
      "Couldn't connect right now. Please try again. Your local work is safe.",
    );
  });

  if (!res.ok) {
    if (
      path.includes("/local-ai") ||
      path.includes("/installed-apps") ||
      path.includes("/organization") ||
      path.includes("/jobs/") ||
      path.includes("/actions/")
    ) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        typeof body.detail === "string"
          ? body.detail
          : "Couldn't finish this task. Please try again.",
      );
    }
    const messages: Record<number, string> = {
      401: "Please sign in again, or check your email and password.",
      403: "Access is restricted. Choose an accessible file inside an added folder.",
      404: "This item is no longer available. Refresh the view and try again.",
      409: path.includes("/sync/google")
        ? "Sign in with your email first, then connect Google from Account → Sign-in options."
        : path === "/api/sync/login"
          ? "An account already uses this email. Try signing in instead."
          : "A newer change is already saved. Refresh and try again.",
      410: "This sign-in session expired. Please try again.",
      422: "Check the information you entered and try again.",
      429: "Too many attempts. Please wait a moment and try again.",
    };
    throw new Error(
      messages[res.status] ||
        (res.status >= 500
          ? "Groundwork couldn't connect right now. Please try again. Your local work is safe."
          : "That didn't work. Please try again."),
    );
  }

  return res.json() as Promise<T>;
}

export const api = {
  fileStorage: (path: string) => request<{logical_bytes: number; allocated_bytes: number | null; hard_links: number; allocation_note: string}>(`/api/system/file-storage?path=${encodeURIComponent(path)}`),
  cancelOrganization: () => request("/api/ai/organization", {method: "POST", body: JSON.stringify({action: "cancel"})}),
  organizationProgress: () =>
    request<{
      phase: string;
      checked: number;
      completed: number;
      total: number;
      bytes: number;
      current_size?: number;
    }>("/api/ai/organization/progress"),
  proposeAction: (instruction: string, paths: string[]) =>
    request<
      AssistantJob<{
        proposal: { action: string; value: string };
        confirmation_token: string;
      }>
    >("/api/ai/actions/propose", {
      method: "POST",
      body: JSON.stringify({ instruction, paths }),
    }),
  executeAction: (
    proposal: { action: string; value: string },
    confirmation_token: string,
  ) =>
    request<Record<string, unknown>>("/api/ai/actions/execute", {
      method: "POST",
      body: JSON.stringify({ proposal, confirmation_token }),
    }),
  localAIStatus: () =>
    request<import("../components/assistant/LocalAISetup").LocalAIStatus>(
      "/api/system/local-ai",
    ),
  localAIAction: (action: string, model?: string, path?: string) =>
    request<import("../components/assistant/LocalAISetup").LocalAIStatus>(
      "/api/system/local-ai",
      { method: "POST", body: JSON.stringify({ action, model, path }) },
    ),
  importLocalModel: (filePath: string, modelId?: string) =>
    request<{ status: string; model_id: string; name: string }>(
      "/api/system/local-ai",
      { method: "POST", body: JSON.stringify({ action: "import", path: filePath, model: modelId || "small" }) },
    ),
  startQuestion: (question: string, file_paths: string[], provider: string) =>
    request<AssistantJob<AIQueryResponse>>("/api/ai/jobs/query", {
      method: "POST",
      body: JSON.stringify({ question, file_paths, provider }),
    }),
  assistantJob: <T>(id: string) =>
    request<AssistantJob<T>>(`/api/ai/jobs/${id}`),
  organize: <T>(values: Record<string, unknown>) =>
    request<AssistantJob<T>>("/api/ai/organization", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  organizationHistory: () =>
    request<import("../components/assistant/OrganizeView").Plan[]>(
      "/api/ai/organization/history",
    ),
  listRules: (folder?: string) =>
    request<Array<{ id: string; folder_path: string; name: string; rule_type: string; instruction: string; categories: string[]; created_at: number; updated_at: number }>>(
      "/api/ai/organization/rules" + (folder ? `?folder=${encodeURIComponent(folder)}` : ""),
    ),
  saveRule: (folder_path: string, name: string, rule_type: string, instruction = "", categories: string[] = []) =>
    request<{ id: string; folder_path: string; name: string; rule_type: string; instruction: string; categories: string[] }>(
      "/api/ai/organization",
      { method: "POST", body: JSON.stringify({ action: "save_rule", destination: folder_path, rule_name: name, rule_type, instruction, categories }) },
    ),
  deleteRule: (rule_id: string) =>
    request<{ success: boolean }>("/api/ai/organization", {
      method: "POST",
      body: JSON.stringify({ action: "delete_rule", rule_id }),
    }),
  runRule: (rule_id: string, destination?: string) =>
    request<AssistantJob<import("../components/assistant/OrganizeView").Plan>>("/api/ai/organization", {
      method: "POST",
      body: JSON.stringify({ action: "run_rule", rule_id, destination: destination || "" }),
    }),
  listPreferences: () =>
    request<Array<{ id: string; name: string; categories: string[]; instructions: string; created_at: number; updated_at: number }>>(
      "/api/ai/organization/preferences",
    ),
  savePreference: (name: string, categories: string[], instructions = "") =>
    request<{ id: string; name: string; categories: string[]; instructions: string }>(
      "/api/ai/organization",
      { method: "POST", body: JSON.stringify({ action: "save_preference", rule_name: name, categories, instruction: instructions }) },
    ),
  deletePreference: (id: string) =>
    request<{ success: boolean }>("/api/ai/organization", {
      method: "POST",
      body: JSON.stringify({ action: "delete_preference", rule_id: id }),
    }),
  createSampleFolder: () =>
    request<{ folder_path: string; files: string[]; message: string }>(
      "/api/ai/organization/sample",
      { method: "POST" },
    ),
  getDuplicates: (workspace_id?: string) =>
    request<{
      exact_duplicates: Array<{
        sha256: string;
        size_bytes: number;
        file_count: number;
        potential_waste_bytes: number;
        files: Array<{ path: string; name: string; size_bytes: number; mtime: number; extension: string }>;
      }>;
      similar_names: Array<{
        base_name: string;
        file_count: number;
        files: Array<{ path: string; name: string; size_bytes: number; mtime: number; extension: string }>;
      }>;
      total_exact_groups: number;
      total_duplicate_files: number;
      total_potential_waste_bytes: number;
      note: string;
    }>("/api/system/duplicates" + (workspace_id ? `?workspace_id=${encodeURIComponent(workspace_id)}` : "")),
  getCapabilities: () =>
    request<Record<string, { available: boolean; status?: string; label: string; description: string }>>(
      "/api/system/capabilities",
    ),
  getReadableFormats: () =>
    request<{
      extensions: string[];
      special_names: string[];
      max_bytes: number;
      max_files: number;
      lines_per_file: number;
    }>("/api/system/readable-formats"),
  getComputerStatus: () =>
    request<import("../components/computer/ComputerView").ComputerStatus>(
      "/api/system/computer",
    ),
  getInstalledApps: (refresh = false) => request<{ apps: InstalledApp[]; supported: boolean }>(`/api/system/installed-apps?refresh=${refresh}`, { signal: AbortSignal.timeout(70000) }),
  launchInstalledApp: (id: string) => request<{ success: boolean }>("/api/system/installed-apps/launch", { method: "POST", body: JSON.stringify({ path: id }) }),
  desktopAction: (action: string, value: string, confirmation_token?: string) =>
    request<{
      success?: boolean;
      path?: string;
      confirmation_required?: boolean;
      confirmation_token?: string;
    }>("/api/system/desktop-action", {
      method: "POST",
      body: JSON.stringify({ action, value, confirmation_token }),
    }),
  browseInventory: (id: string, values: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined) params.set(key, value);
    });
    return request<import("../types/api").InventoryResult>(
      `/api/workspaces/${encodeURIComponent(id)}/inventory?${params}`,
    );
  },
  browseAllInventory: (values: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => { if (value !== undefined) params.set(key, value); });
    return request<import("../types/api").InventoryResult>(`/api/workspaces/inventory/all?${params}`);
  },
  restartLocalCore: async () => {
    if (!isTauri())
      throw new Error(
        "Service restart is available in the installed desktop app",
      );
    await invoke("stop_local_core");
    connectionPromise = undefined;
    return getConnection();
  },
  getFileHistory: (projectId: string, path: string) =>
    request<{
      path: string;
      diff: string;
      commits: Array<{ hash: string; message: string }>;
    }>(
      `/api/git/projects/${encodeURIComponent(projectId)}/file-history?path=${encodeURIComponent(path)}`,
    ),
  getPreferences: () =>
    request<Record<string, string | boolean | null>>("/api/system/preferences"),
  updatePreferences: (values: Record<string, string | null>) =>
    request<Record<string, string | boolean | null>>(
      "/api/system/preferences",
      { method: "PUT", body: JSON.stringify(values) },
    ),
  loginCloud: (email: string, password: string, register = false) =>
    request<{ status: string }>("/api/sync/login", {
      method: "POST",
      body: JSON.stringify({ email, password, register }),
    }),
  logoutCloud: () =>
    request<{ status: string }>("/api/sync/logout", { method: "POST" }),
  startGoogleSignIn: (link = false) =>
    request<{ session_id: string }>("/api/sync/google/start", {
      method: "POST",
      body: JSON.stringify({ link }),
    }),
  pollGoogleSignIn: (session_id: string) =>
    request<{ status: string }>("/api/sync/google/poll", {
      method: "POST",
      body: JSON.stringify({ session_id }),
    }),
  cancelGoogleSignIn: (session_id: string) =>
    request<{ status: string }>("/api/sync/google/cancel", {
      method: "POST",
      body: JSON.stringify({ session_id }),
    }),

  // System
  getSystemStatus: () => request<SystemStatus>("/api/system/status"),
  openFile: (path: string) =>
    request<{ success: boolean }>("/api/system/open-file", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  openFolder: (path: string) =>
    request<{ success: boolean }>("/api/system/open-folder", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  revealFile: (path: string) =>
    request<{ success: boolean }>("/api/system/reveal-file", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  pickWorkspaceFolder: () =>
    isTauri()
      ? invoke<string | null>("pick_workspace_folder")
      : Promise.resolve(null),

  // Workspaces
  pickAIModel: () => isTauri() ? invoke<string | null>("pick_ai_model") : Promise.resolve(null),
  listWorkspaces: () => request<Workspace[]>("/api/workspaces"),
  createWorkspace: (name: string, path: string) =>
    request<Workspace>("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name, path }),
    }),
  deleteWorkspace: (id: string) =>
    request<{ deleted: boolean }>(`/api/workspaces/${id}`, {
      method: "DELETE",
    }),

  // Projects
  listProjects: (workspaceId?: string) =>
    request<Project[]>(
      workspaceId
        ? `/api/projects?workspace_id=${workspaceId}`
        : "/api/projects",
    ),
  getProjectOverview: (projectId: string) =>
    request<ProjectOverview>(`/api/projects/${projectId}/overview`),

  // Indexer
  getIndexProgress: () => request<IndexProgress>("/api/index/status"),
  startIndexing: (workspaceId?: string) =>
    request<IndexProgress>(
      workspaceId
        ? `/api/index/start?workspace_id=${encodeURIComponent(workspaceId)}`
        : "/api/index/start",
      {
        method: "POST",
        body: JSON.stringify([]),
      },
    ),
  indexSelectedFiles: (paths: string[], workspaceId?: string) =>
    request<IndexProgress>(
      "/api/index/selected" + (workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ""),
      {
        method: "POST",
        body: JSON.stringify(paths),
      },
    ),
  cancelIndexing: () =>
    request<IndexProgress>("/api/index/cancel", { method: "POST" }),

  // Search
  searchWorkspace: (
    q: string,
    mode: string = "hybrid",
    projectId?: string,
    limit: number = 25,
    fileType?: string,
    modifiedAfter?: number,
  ) => {
    const params = new URLSearchParams({ q, mode, limit: limit.toString() });
    if (projectId) params.append("project_id", projectId);
    if (fileType) params.append("file_type", fileType);
    if (modifiedAfter !== undefined)
      params.append("modified_after", String(modifiedAfter));
    return request<SearchResponse>(`/api/search?${params.toString()}`);
  },

  // Git
  getGitCommits: (query?: string, projectId?: string) => {
    const params = new URLSearchParams();
    if (query) params.append("query", query);
    if (projectId) params.append("project_id", projectId);
    return request<
      Array<{
        hash: string;
        short_hash: string;
        author: string;
        date: string;
        message: string;
        project_name: string;
      }>
    >(`/api/git/commits?${params.toString()}`);
  },

  // Activity
  listActivities: (days: number = 7, projectId?: string) => {
    const params = new URLSearchParams({ days: days.toString() });
    if (projectId) params.append("project_id", projectId);
    return request<ActivityItem[]>(`/api/activity?${params.toString()}`);
  },
  getActivitySummary: (days: number = 2) =>
    request<{
      period_days: number;
      concise_summary: string;
      active_projects: string[];
      modified_files: Array<{
        filename: string;
        path: string;
        project: string;
        mtime: string;
      }>;
      recent_commits: Array<{
        hash: string;
        author: string;
        date: string;
        message: string;
        project: string;
      }>;
      active_sessions: Array<{
        title: string;
        status: string;
        project: string;
      }>;
    }>(`/api/activity/summary?days=${days}`),

  // Context Sessions
  listSessions: (projectId?: string) =>
    request<ContextSession[]>(
      projectId
        ? `/api/context-sessions?project_id=${projectId}`
        : "/api/context-sessions",
    ),
  createSession: (
    title: string,
    projectId?: string,
    summary?: string,
    filesInspected: string[] = [],
  ) =>
    request<ContextSession>("/api/context-sessions", {
      method: "POST",
      body: JSON.stringify({
        title,
        project_id: projectId,
        summary,
        files_inspected: filesInspected,
      }),
    }),
  updateSession: (id: string, updates: Partial<ContextSession>) =>
    request<ContextSession>(`/api/context-sessions/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),

  // Notes
  listNotes: (query?: string, projectId?: string) => {
    const params = new URLSearchParams();
    if (query) params.append("q", query);
    if (projectId) params.append("project_id", projectId);
    return request<Note[]>(`/api/notes?${params.toString()}`);
  },
  createNote: (
    title: string,
    content: string,
    projectId?: string,
    filePath?: string,
    tags: string[] = [],
  ) =>
    request<Note>("/api/notes", {
      method: "POST",
      body: JSON.stringify({
        title,
        content,
        project_id: projectId,
        file_path: filePath,
        tags,
      }),
    }),
  updateNote: (id: string, updates: Partial<Note>) =>
    request<Note>(`/api/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),
  deleteNote: (id: string) =>
    request<{ deleted: boolean }>(`/api/notes/${id}`, { method: "DELETE" }),

  // Saved Searches
  listSavedSearches: () => request<SavedSearch[]>("/api/saved-searches"),
  createSavedSearch: (title: string, query: string) =>
    request<SavedSearch>("/api/saved-searches", {
      method: "POST",
      body: JSON.stringify({ title, query }),
    }),
  deleteSavedSearch: (id: string) =>
    request<{ deleted: boolean }>(`/api/saved-searches/${id}`, {
      method: "DELETE",
    }),

  // AI
  queryAI: async (
    question: string,
    projectId?: string,
    provider?: string,
    focusedPath?: string,
    focusedLine?: number,
    sessionId?: string,
    filePaths: string[] = [],
  ) =>
    waitForJob(
      await request<AssistantJob<AIQueryResponse>>("/api/ai/jobs/query", {
        method: "POST",
        body: JSON.stringify({
          question,
          project_id: projectId,
          provider,
          file_paths: filePaths,
          focused_path: focusedPath,
          focused_line: focusedLine,
          session_id: sessionId,
        }),
      }),
    ),
  investigateProblem: (
    problemStatement: string,
    projectId?: string,
    provider?: string,
    focusedPath?: string,
    focusedLine?: number,
    sessionId?: string,
  ) =>
    request<{
      session_id: string;
      title: string;
      analysis: string;
      provider_used: string;
      citations: AIQueryResponse["citations"];
      inspected_files: string[];
      related_commits: any[];
      evidence_count: number;
    }>("/api/ai/investigate", {
      method: "POST",
      signal: AbortSignal.timeout(300000),
      body: JSON.stringify({
        problem_statement: problemStatement,
        project_id: projectId,
        provider,
        files: focusedPath ? [focusedPath] : [],
        focused_line: focusedLine || 1,
        session_id: sessionId,
      }),
    }),
  listProviders: () =>
    request<
      Array<{ id: string; name: string; is_local: boolean; active: boolean }>
    >("/api/ai/providers"),
  executeTool: (
    toolName: string,
    args: Record<string, any>,
    confirmationToken?: string,
  ) =>
    request<any>("/api/ai/tools/execute", {
      method: "POST",
      body: JSON.stringify({
        tool_name: toolName,
        arguments: args,
        confirmation_token: confirmationToken,
      }),
    }),

  // Sync
  getSyncStatus: () =>
    request<{
      enabled: boolean;
      cloud_url: string;
      is_authenticated: boolean;
      pending_items: number;
      state: string;
    }>("/api/sync/status"),
  triggerSync: () =>
    request<{
      status: string;
      synced_count?: number;
      message?: string;
      error?: string;
    }>("/api/sync/trigger", { method: "POST" }),
};

export interface AssistantJob<T> {
  id: string;
  status: "running" | "complete" | "error" | "cancelled";
  result: T | null;
  error: string | null;
}
export async function waitForJob<T>(job: AssistantJob<T>): Promise<T> {
  let current = job;
  while (current.status === "running") {
    await new Promise((resolve) => setTimeout(resolve, 600));
    current = await api.assistantJob<T>(current.id);
  }
  if (current.status !== "complete" || current.result === null)
    throw new Error(current.error || "Task cancelled.");
  return current.result;
}
