import type {
  ActivityItem,
  AIQueryResponse,
  ContextSession,
  IndexProgress,
  Note,
  Project,
  ProjectOverview,
  SearchResponse,
  SystemStatus,
  Workspace,
} from "../types/api";

import { invoke, isTauri } from "@tauri-apps/api/core";

export interface InstalledApp {
  id: string; name: string; icon: string; publisher: string; version: string;
  description: string; location: string; kind: string;
  install_location?: string;
  install_date?: string;
  uninstall_string?: string;
  quiet_uninstall_string?: string;
  estimated_size_bytes?: number | null;
  registry_key?: string;
  can_launch?: boolean;
  can_uninstall?: boolean;
}

export interface StorageOverviewResponse {
  drives: Array<{
    path: string;
    total_bytes: number;
    used_bytes: number;
    free_bytes: number;
    used_percent: number;
    workspaces: Array<{ id: string; name: string; path: string }>;
  }>;
  workspaces: Array<{
    id: string;
    name: string;
    path: string;
    files: number;
    bytes: number;
    scan_status: string;
  }>;
  total_files: number;
  total_bytes: number;
  category_breakdown: Array<{
    key: string;
    label: string;
    files: number;
    bytes: number;
    percent: number;
  }>;
  largest_files: Array<{
    workspace_id: string;
    path: string;
    name: string;
    parent: string;
    extension: string;
    category: string;
    size_bytes: number;
    mtime: number;
    share_percent: number;
    allocated_bytes?: number | null;
    allocation_note?: string;
  }>;
  largest_folders: Array<{
    workspace_id: string;
    path: string;
    name: string;
    parent: string;
    size_bytes: number;
    file_count: number;
    mtime: number;
    share_percent: number;
  }>;
  space_map: Array<{
    workspace_id: string;
    path: string;
    name: string;
    kind: "file" | "folder";
    category: string;
    size_bytes: number;
    file_count: number;
    mtime: number;
    share_percent: number;
  }>;
}

export interface CleanupCandidateItem {
  path: string;
  name: string;
  parent: string;
  size_bytes: number;
  mtime: number;
  age_days: number;
  rule_id: string;
  confidence: "high" | "review_required";
  reason: string;
  sha256?: string;
  kept_reference_path?: string;
}

export interface CleanupRuleSummary {
  id: string;
  name: string;
  description: string;
  risk_level: "low" | "medium";
  candidate_count: number;
  reclaimable_bytes: number;
  items: CleanupCandidateItem[];
}

export interface CleanupScanResponse {
  rules: CleanupRuleSummary[];
  total_candidates: number;
  total_reclaimable_bytes: number;
  scanned_workspaces: number;
  safety_notice: string;
}

export interface CleanupProposalResponse {
  proposal: Record<string, unknown>;
  items: Array<{ path: string; name: string; kind: string; size_bytes: number }>;
  skipped: Array<{ path: string; reason: string }>;
  total_bytes: number;
  item_count: number;
  confirmation_token: string;
  warning: string;
}

export interface CleanupExecutionResponse {
  status: "completed" | "partial" | "failed";
  mode: string;
  removed: Array<{ path: string; name: string; kind: string; size_bytes: number; method: string }>;
  failed: Array<{ path: string; reason: string }>;
  skipped: Array<{ path: string; reason: string }>;
  removed_count: number;
  bytes_reclaimed: number;
}

export interface LeftoverScanResponse {
  app_id: string;
  app_name: string;
  publisher: string;
  install_location: string;
  leftovers: Array<{
    path: string;
    name: string;
    kind: "folder" | "file";
    location_group: string;
    size_bytes: number;
    file_count: number;
    mtime: number;
    confidence: "high" | "review_required";
    evidence: string;
  }>;
  registry_leftovers: Array<{
    key: string;
    confidence: "high" | "review_required";
    evidence: string;
  }>;
  total_count: number;
  high_confidence_count: number;
  review_required_count: number;
  total_reclaimable_bytes: number;
  high_confidence_bytes: number;
  safety_notice: string;
}

export interface FileCollection {
  id: string; title: string; revision: number;
  members: Array<{path: string; reason: string; available?: boolean}>;
}
export interface CollectionSuggestions {
  groups: Array<Pick<FileCollection, "title" | "members">>;
  unassigned: string[]; coverage: string;
}
export interface FilePreview {
  path: string; name: string; size: number; modified: number; page: number; pages: number;
  kind: "text" | "pdf" | "image" | "unsupported"; text: string; image: string;
  message: string; line_start: number; total_lines?: number; truncated?: boolean;
}
export function previewFile(path: string, line = 1, automatic = false, neighbors?: string[]) {
  window.dispatchEvent(new CustomEvent("groundwork-preview", {detail: {path, line, automatic, neighbors}}));
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
  const timeout = AbortSignal.timeout(15000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const res = await fetch(url, {
    ...options,
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(connection.token
        ? { Authorization: `Bearer ${connection.token}` }
        : {}),
      ...(options.headers || {}),
    },
  }).catch((error) => {
    if (options.signal?.aborted) throw error;
    if (timeout.aborted) throw new Error(options.method && options.method !== "GET"
      ? "This request timed out. Check whether it completed before trying again."
      : "Groundwork took too long to respond. Please try again.");
    if (isTauri()) connectionPromise = undefined;
    throw new Error(
      "Couldn't connect right now. Please try again. Your local work is safe.",
    );
  });

  if (!res.ok) {
    if (
      path.includes("/local-ai") ||
      path.includes("/file-preview") ||
      path.includes("/collections/") ||
      path.includes("/installed-apps") ||
      path.includes("/cleanup/") ||
      path.includes("/storage-overview") ||
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
  organizationProgress: () =>
    request<{
      phase: string;
      checked: number;
      completed: number;
      total: number;
      bytes: number;
      current_size?: number;
    }>("/api/ai/organization/progress"),
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
  startQuestion: (question: string, file_paths: string[], provider: string, search_workspace = false, focused_line = 1, collection_id?: string) =>
    request<AssistantJob<AIQueryResponse>>("/api/ai/jobs/query", {
      method: "POST",
      body: JSON.stringify({ question, file_paths, provider, search_workspace, focused_line, collection_id }),
    }),
  listCollections: () => request<FileCollection[]>("/api/context-sessions/collections/list"),
  previewFile: (path: string, page = 1, signal?: AbortSignal) => request<FilePreview>(`/api/system/file-preview?${new URLSearchParams({path, page: String(page)})}`, {signal}),
  saveCollection: (collection: FileCollection) => request<FileCollection>(`/api/context-sessions/collections/${collection.id}`, {method: "PUT", body: JSON.stringify(collection)}),
  deleteCollection: (collection: FileCollection) => request(`/api/context-sessions/collections/${collection.id}?revision=${collection.revision}`, {method: "DELETE"}),
  suggestCollections: (paths: string[], provider: string) => request<AssistantJob<CollectionSuggestions>>("/api/context-sessions/collections/suggest", {method: "POST", body: JSON.stringify({paths, provider})}),
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
  getComputerStatus: () =>
    request<import("../components/computer/ComputerView").ComputerStatus>(
      "/api/system/computer",
    ),
  getInstalledApps: (refresh = false) => request<{ apps: InstalledApp[]; supported: boolean }>(`/api/system/installed-apps?refresh=${refresh}`, { signal: AbortSignal.timeout(70000) }),
  launchInstalledApp: (id: string) => request<{ success: boolean }>("/api/system/installed-apps/launch", { method: "POST", body: JSON.stringify({ path: id }) }),
  proposeAppUninstall: (id: string) =>
    request<{
      proposal: {
        action: string;
        app_id: string;
        app_name: string;
        publisher: string;
        version: string;
        install_location: string;
        uninstall_command: string;
        argv: string[];
      };
      confirmation_token: string;
      warning: string;
    }>("/api/system/installed-apps/uninstall/propose", {
      method: "POST",
      body: JSON.stringify({ path: id }),
    }),
  executeAppUninstall: (proposal: Record<string, unknown>, confirmation_token: string) =>
    request<{
      status: string;
      pid: number;
      app_id: string;
      app_name: string;
      publisher: string;
      install_location: string;
      command: string;
      can_scan_leftovers: boolean;
    }>("/api/system/installed-apps/uninstall/execute", {
      method: "POST",
      body: JSON.stringify({ proposal, confirmation_token }),
    }),
  scanAppLeftovers: (params: { app_id?: string; app_name?: string; publisher?: string; install_location?: string }) =>
    request<LeftoverScanResponse>("/api/system/installed-apps/leftovers", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  proposeLeftoverCleanup: (paths: string[], mode: "recycle" | "permanent" = "recycle") =>
    request<CleanupProposalResponse>("/api/system/installed-apps/leftovers/propose", {
      method: "POST",
      body: JSON.stringify({ paths, mode }),
    }),
  executeLeftoverCleanup: (proposal: Record<string, unknown>, confirmation_token: string) =>
    request<CleanupExecutionResponse>("/api/system/installed-apps/leftovers/execute", {
      method: "POST",
      body: JSON.stringify({ proposal, confirmation_token }),
    }),
  getStorageOverview: (workspace_id?: string, limit = 12) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (workspace_id) params.set("workspace_id", workspace_id);
    return request<StorageOverviewResponse>(`/api/system/storage-overview?${params.toString()}`);
  },
  scanCleanupCandidates: (workspace_id?: string, stale_days = 60, min_large_mb = 25) => {
    const params = new URLSearchParams({
      stale_days: String(stale_days),
      min_large_mb: String(min_large_mb),
    });
    if (workspace_id) params.set("workspace_id", workspace_id);
    return request<CleanupScanResponse>(`/api/system/cleanup/scan?${params.toString()}`);
  },
  proposeCleanup: (paths: string[], mode: "recycle" | "permanent" = "recycle") =>
    request<CleanupProposalResponse>("/api/system/cleanup/propose", {
      method: "POST",
      body: JSON.stringify({ paths, mode }),
    }),
  executeCleanup: (proposal: Record<string, unknown>, confirmation_token: string) =>
    request<CleanupExecutionResponse>("/api/system/cleanup/execute", {
      method: "POST",
      body: JSON.stringify({ proposal, confirmation_token }),
    }),
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

  // AI
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
