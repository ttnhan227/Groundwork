import React, { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Activity,
  FolderPlus,
  Folder,
  Bell,
  Settings,
  BookOpen,
} from "lucide-react";
import type {
  AuthResult,
  DocumentItem,
  Job,
  NativeDocument,
  Stats,
  Workspace,
} from "../../types";
import { BrandMark } from "../../components/common/BrandMark";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Sidebar } from "../../components/layout/Sidebar";
import { CommandPalette, type WorkspaceCommand } from "./CommandPalette";
import {
  API,
  AUTH_EXPIRED_EVENT,
  AUTH_REFRESHED_EVENT,
  api,
  authenticatedFetch,
  getStoredAuth,
  setStoredAuth,
} from "../../api/client";
import { AccountPanel as AccountSettingsPanel } from "../account/AccountPanel";
import { NotificationCenter } from "../account/NotificationCenter";
import {
  applyPreferences,
  storedPreferences,
  PREFERENCES_CHANGED_EVENT,
  type UserPreferences,
} from "../account/preferences";
import { WorkspaceLibrary } from "./WorkspaceLibrary";
import { ResearchWorkspace } from "./ResearchWorkspace";
import { PdfViewerModal } from "../pdf-viewer/PdfViewerModal";

const REGISTRATION_ENABLED =
  (import.meta.env.VITE_REGISTRATION_ENABLED ?? "true").toLowerCase() !==
  "false";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";

type GoogleCredentialResponse = { credential: string };
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: Record<string, string | number>,
          ) => void;
        };
      };
    };
  }
}

function GoogleSignInButton({
  disabled,
  onCredential,
  onError,
}: {
  disabled: boolean;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  const initializedRef = useRef(false);

  useEffect(() => {
    onCredentialRef.current = onCredential;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || disabled) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !buttonRef.current || !window.google) return;
      if (!initializedRef.current) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => onCredentialRef.current(response.credential),
        });
        initializedRef.current = true;
      }
      buttonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        width: Math.min(360, buttonRef.current.clientWidth || 360),
      });
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    if (existing) {
      if (window.google) render();
      else existing.addEventListener("load", render, { once: true });
      return () => {
        cancelled = true;
        existing.removeEventListener("load", render);
      };
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = render;
    script.onerror = () =>
      onErrorRef.current(
        "Google sign-in could not be loaded. Check connection.",
      );
    document.head.appendChild(script);
    return () => {
      cancelled = true;
    };
  }, [disabled]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <div
      className={`w-full flex justify-center ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      ref={buttonRef}
      aria-label="Continue with Google"
    />
  );
}

const authSchema = z.object({
  display_name: z.string().trim().max(120).optional(),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
type AuthFields = z.infer<typeof authSchema>;

function ProcessingJobsModal({
  token,
  onClose,
}: {
  token: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api<Job[]>("/jobs", token)
        .then(setItems)
        .catch((reason) => setError(reason.message)),
    [token],
  );

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 2500);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Background Processing Jobs"
      eyebrow="Activity Monitor"
    >
      <div className="space-y-3 jobs-panel min-w-0">
        {error && (
          <div className="p-2 rounded bg-[var(--danger-bg)] text-xs text-[var(--danger)]">
            {error}
          </div>
        )}
        {items.map((job) => (
          <div
            key={job.id}
            className="p-3 rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-xs flex items-center justify-between gap-3 min-w-0"
          >
            <div className="min-w-0 flex-1">
              <strong className="block font-medium text-[var(--ink)] truncate">
                {(job.operation ?? "document processing").replaceAll("_", " ")}
              </strong>
              <span className="text-[11px] text-[var(--ink-muted)] font-mono">
                {job.created_at
                  ? new Date(job.created_at).toLocaleTimeString()
                  : ""}{" "}
                · {job.progress}%
              </span>
            </div>
            <span className="job-state font-mono text-[11px] px-1.5 py-0.5 rounded bg-[var(--paper-subtle)] font-medium flex-shrink-0">
              {job.status}
            </span>
          </div>
        ))}
        {items.length === 0 && !error && (
          <p className="text-xs text-[var(--ink-muted)] text-center py-4">
            No processing jobs active.
          </p>
        )}
      </div>
    </Modal>
  );
}

export function WorkspaceApp({
  pendingUpload,
  onPendingUploadHandled,
  onExit,
}: {
  pendingUpload: File | null;
  onPendingUploadHandled: () => void;
  onExit: () => void;
}) {
  const [initialAuth] = useState<AuthResult | null>(() => getStoredAuth());
  const [token, setToken] = useState(initialAuth?.access_token ?? "");
  const [user, setUser] = useState<AuthResult["user"] | null>(
    initialAuth?.user ?? null,
  );
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<DocumentItem | null>(null);
  const [viewerPage, setViewerPage] = useState(1);
  const [viewerSearch, setViewerSearch] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [, setNotificationUnread] = useState(0);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("ws") || null,
  );
  const [activeNativeDocumentId, setActiveNativeDocumentId] = useState<
    string | null
  >(null);
  const [hasUnsavedDraftChanges, setHasUnsavedDraftChanges] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<
    (() => void) | null
  >(null);
  const [libraryCreateRequestKey, setLibraryCreateRequestKey] = useState(0);
  const [nativeDocs, setNativeDocs] = useState<NativeDocument[]>([]);
  const [workspaceView, setWorkspaceView] = useState<"library" | "workspace">(
    () =>
      new URLSearchParams(window.location.search).has("ws")
        ? "workspace"
        : "library",
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    () => window.innerWidth >= 1600,
  );
  const [activeTheme, setActiveTheme] = useState<"light" | "dark">(() =>
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light",
  );
  const [isInitialLoading, setIsInitialLoading] = useState(
    Boolean(initialAuth),
  );
  const pendingUploadStarted = useRef(false);

  const authForm = useForm<AuthFields>({
    resolver: zodResolver(authSchema),
    defaultValues: { display_name: "", email: "", password: "" },
  });

  useEffect(() => {
    applyPreferences(storedPreferences());
  }, []);

  useEffect(() => {
    const keepWorkAreaUsable = () => {
      if (window.innerWidth < 1600) setIsSidebarOpen(false);
    };
    keepWorkAreaUsable();
    window.addEventListener("resize", keepWorkAreaUsable);
    return () => window.removeEventListener("resize", keepWorkAreaUsable);
  }, []);

  useEffect(() => {
    function handlePrefsChange(e: Event) {
      const detail = (e as CustomEvent<UserPreferences>).detail;
      if (detail?.theme) {
        if (detail.theme === "system") {
          const isDark =
            typeof window !== "undefined" &&
            window.matchMedia?.("(prefers-color-scheme: dark)").matches;
          setActiveTheme(isDark ? "dark" : "light");
        } else {
          setActiveTheme(detail.theme);
        }
      }
    }
    window.addEventListener(PREFERENCES_CHANGED_EVENT, handlePrefsChange);
    return () =>
      window.removeEventListener(PREFERENCES_CHANGED_EVENT, handlePrefsChange);
  }, []);

  useEffect(() => {
    if (!token || !user) return;
    const loadUnread = () =>
      api<{ unread: number }>("/notifications/unread-count", token)
        .then((v) => setNotificationUnread(v.unread))
        .catch(() => undefined);
    loadUnread();
    const timer = window.setInterval(loadUnread, 10_000);
    return () => window.clearInterval(timer);
  }, [token, user]);

  useEffect(() => {
    function handleExpiredSession() {
      setToken("");
      setUser(null);
      setDocuments([]);
      setViewer(null);
      setAccountOpen(false);
      setNotificationsOpen(false);
      setNotificationUnread(0);
      setError("Your session expired. Please log in again.");
    }
    function handleRefreshedSession(event: Event) {
      const refreshed = (event as CustomEvent<AuthResult>).detail;
      setToken(refreshed.access_token);
      setUser(refreshed.user);
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession);
    window.addEventListener(AUTH_REFRESHED_EVENT, handleRefreshedSession);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession);
      window.removeEventListener(AUTH_REFRESHED_EVENT, handleRefreshedSession);
    };
  }, []);

  const loadDocuments = useCallback(async (accessToken: string) => {
    try {
      const items = await api<DocumentItem[]>("/documents", accessToken);
      setDocuments(items);
    } catch (reason) {
      setDocuments([]);
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load source documents",
      );
    }
  }, []);

  const loadStats = useCallback(async (accessToken: string) => {
    setStats(await api<Stats>("/profile/stats", accessToken));
  }, []);

  const loadWorkspaces = useCallback(async (accessToken: string) => {
    try {
      const items = await api<Workspace[]>("/workspaces", accessToken);
      setWorkspaces(items);
      return items;
    } catch (reason) {
      setWorkspaces([]);
      setError(
        reason instanceof Error ? reason.message : "Could not load responses",
      );
      return [];
    }
  }, []);

  const loadAllNativeDocs = useCallback(async (accessToken: string) => {
    try {
      const wsList = await api<Workspace[]>("/workspaces", accessToken);
      const allDocs: NativeDocument[] = [];
      for (const ws of wsList) {
        const docs = await api<NativeDocument[]>(
          `/workspaces/${ws.id}/native-documents`,
          accessToken,
        ).catch(() => []);
        allDocs.push(...docs);
      }
      setNativeDocs(allDocs);
      return allDocs;
    } catch (reason) {
      setNativeDocs([]);
      setError(
        reason instanceof Error ? reason.message : "Could not load drafts",
      );
      return [];
    }
  }, []);

  function toggleTheme() {
    const next: "light" | "dark" = activeTheme === "dark" ? "light" : "dark";
    setActiveTheme(next);
    const current = storedPreferences();
    const updated: UserPreferences = { ...current, theme: next };
    applyPreferences(updated);
    if (token) {
      api("/profile/preferences", token, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      }).catch(() => undefined);
    }
  }

  async function handleCreateWorkspace(
    name: string,
    template?: string,
  ): Promise<string | null> {
    try {
      const newWs = await api<Workspace>("/workspaces", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind: "personal", template }),
      });
      setWorkspaces((prev) => [newWs, ...prev]);
      setActiveWorkspaceId(newWs.id);
      setWorkspaceView("workspace");
      return newWs.id;
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Could not create response",
      );
      return null;
    }
  }

  async function handleCreateNativeDocument(
    workspaceId: string,
    title = "Response draft",
    sourceDocumentIds: string[] = [],
  ): Promise<NativeDocument | null> {
    try {
      const draft = await api<NativeDocument>(
        `/workspaces/${workspaceId}/native-documents`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            source_document_ids: sourceDocumentIds,
          }),
        },
      );
      setNativeDocs((current) => [
        draft,
        ...current.filter((item) => item.id !== draft.id),
      ]);
      setActiveWorkspaceId(workspaceId);
      setActiveNativeDocumentId(draft.id);
      setWorkspaceView("workspace");
      return draft;
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Could not create response draft",
      );
      return null;
    }
  }

  async function handleDeleteWorkspace(wsId: string): Promise<void> {
    try {
      await api(`/workspaces/${wsId}`, token, { method: "DELETE" });
      setWorkspaces((prev) => prev.filter((w) => w.id !== wsId));
      if (activeWorkspaceId === wsId) {
        setActiveWorkspaceId(null);
        setWorkspaceView("library");
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to delete response";
      setError(message);
      throw new Error(message);
    }
  }

  async function handleRenameWorkspace(
    wsId: string,
    newName: string,
  ): Promise<void> {
    try {
      const updated = await api<Workspace>(`/workspaces/${wsId}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      setWorkspaces((prev) => prev.map((w) => (w.id === wsId ? updated : w)));
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to rename response",
      );
    }
  }

  async function handleUploadWorkspaceDocument(
    file: File,
    wsId: string,
  ): Promise<DocumentItem | null> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("workspace_id", wsId);

    const response = await authenticatedFetch(`${API}/documents`, token, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.detail || "Upload failed");
    }
    const uploaded = (await response.json()) as DocumentItem;
    setDocuments((prev) => [uploaded, ...prev]);
    return uploaded;
  }

  useEffect(() => {
    if (!initialAuth) {
      setIsInitialLoading(false);
      return;
    }
    setIsInitialLoading(true);
    Promise.all([
      loadDocuments(initialAuth.access_token),
      loadStats(initialAuth.access_token),
      loadWorkspaces(initialAuth.access_token),
      loadAllNativeDocs(initialAuth.access_token),
    ]).finally(() => setIsInitialLoading(false));
  }, [
    initialAuth,
    loadDocuments,
    loadStats,
    loadWorkspaces,
    loadAllNativeDocs,
  ]);

  useEffect(() => {
    if (
      !pendingUpload ||
      !token ||
      !user ||
      isInitialLoading ||
      pendingUploadStarted.current
    ) {
      return;
    }

    pendingUploadStarted.current = true;
    const sourceName = pendingUpload.name.replace(/\.[^.]+$/, "").trim();
    const workspaceName = sourceName || "New RFP response";

    void (async () => {
      try {
        const workspace = await api<Workspace>("/workspaces", token, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: workspaceName,
            kind: "personal",
            template: "blank",
          }),
        });
        const formData = new FormData();
        formData.append("file", pendingUpload);
        formData.append("workspace_id", workspace.id);
        const response = await authenticatedFetch(`${API}/documents`, token, {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.detail || "Upload failed");
        }
        const uploaded = (await response.json()) as DocumentItem;
        setWorkspaces((current) => [
          workspace,
          ...current.filter((item) => item.id !== workspace.id),
        ]);
        setDocuments((current) => [uploaded, ...current]);
        setActiveWorkspaceId(workspace.id);
        setWorkspaceView("workspace");
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not create a response from that file",
        );
      } finally {
        onPendingUploadHandled();
      }
    })();
  }, [
    isInitialLoading,
    onPendingUploadHandled,
    pendingUpload,
    token,
    user,
  ]);

  // Keyboard shortcut ⌘K and Escape
  useEffect(() => {
    function keyboardShortcuts(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((v) => !v);
      }
      if (event.key === "Escape") {
        setViewer(null);
        setCommandPaletteOpen(false);
        setAccountOpen(false);
        setNotificationsOpen(false);
        setJobsOpen(false);
      }
    }
    window.addEventListener("keydown", keyboardShortcuts);
    return () => window.removeEventListener("keydown", keyboardShortcuts);
  }, []);

  const workspaceCommands: WorkspaceCommand[] = user
    ? [
        {
          id: "library",
          label: "Open Response Library",
          detail: "Browse all bid responses",
          icon: <BookOpen size={16} />,
          shortcut: "⌘L",
          run: () =>
            navigateWithDraftGuard(() => setWorkspaceView("library")),
        },
        {
          id: "new-workspace",
          label: "New Response",
          detail: "Create a new bid response",
          icon: <FolderPlus size={16} />,
          run: () => navigateWithDraftGuard(openResponseCreator),
        },
        {
          id: "jobs",
          label: "View processing jobs",
          detail: "Inspect background task progress",
          icon: <Activity size={16} />,
          shortcut: "⌘J",
          run: () => setJobsOpen(true),
        },
        {
          id: "notifications",
          label: "Activity & Notifications",
          detail: "View updates, alerts, and task progress",
          icon: <Bell size={16} />,
          run: () => setNotificationsOpen(true),
        },
        {
          id: "account",
          label: "Account & Preferences",
          detail: "Manage profile, appearance, and settings",
          icon: <Settings size={16} />,
          shortcut: "⌘,",
          run: () => setAccountOpen(true),
        },
        ...workspaces.map((ws) => ({
          id: `workspace-${ws.id}`,
          label: `Open: ${ws.name}`,
          detail: ws.kind === "team" ? "Team response" : "Personal response",
          icon: <Folder size={16} />,
          run: () => {
            navigateWithDraftGuard(() => {
              setActiveNativeDocumentId(null);
              setActiveWorkspaceId(ws.id);
              setWorkspaceView("workspace");
            });
          },
        })),
      ]
    : [];

  function navigateWithDraftGuard(action: () => void) {
    if (hasUnsavedDraftChanges) {
      setPendingNavigation(() => action);
      return;
    }
    action();
  }

  function openResponseCreator() {
    setWorkspaceView("library");
    setLibraryCreateRequestKey((value) => value + 1);
  }

  async function authenticate(values: AuthFields) {
    setBusy(true);
    setError("");
    try {
      const result = await api<AuthResult>(`/auth/${mode}`, undefined, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          ...(mode === "register" ? { display_name: values.display_name } : {}),
        }),
      });
      setStoredAuth(result);
      setToken(result.access_token);
      setUser(result.user);
      await Promise.all([
        loadDocuments(result.access_token),
        loadStats(result.access_token),
        loadWorkspaces(result.access_token),
        loadAllNativeDocs(result.access_token),
      ]);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Authentication failed",
      );
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    setStoredAuth(null);
    setToken("");
    setUser(null);
    setDocuments([]);
    onExit();
  }

  if (!token || !user) {
    return (
      <main className="min-h-screen w-full bg-[var(--paper)] flex items-center justify-center p-4 min-w-0">
        <div className="w-full max-w-sm bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-lg)] shadow-[var(--shadow-card)] p-6 sm:p-8 space-y-6 min-w-0">
          <div className="text-center space-y-1.5 min-w-0">
            <BrandMark size={28} className="mx-auto" />
            <h1 className="font-serif text-2xl font-bold text-[var(--ink)] tracking-tight">
              Ground<span className="text-[var(--ink-blue)]">work</span>
            </h1>
            <p className="text-xs text-[var(--ink-secondary)] break-words">
              Sign in to organize research sources, synthesize findings, and review grounded evidence.
            </p>
          </div>

          <GoogleSignInButton
            disabled={busy}
            onCredential={async (cred) => {
              setBusy(true);
              setError("");
              try {
                const result = await api<AuthResult>("/auth/google", undefined, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ credential: cred }),
              });
                setStoredAuth(result);
                setToken(result.access_token);
                setUser(result.user);
                await Promise.all([
                  loadDocuments(result.access_token),
                  loadStats(result.access_token),
                  loadWorkspaces(result.access_token),
                  loadAllNativeDocs(result.access_token),
                ]);
              } catch (reason) {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Google sign-in failed",
                );
              } finally {
                setBusy(false);
              }
            }}
            onError={setError}
          />

          <form
            onSubmit={authForm.handleSubmit(authenticate)}
            className="space-y-3 min-w-0"
          >
            {mode === "register" && (
              <div>
                <label
                  htmlFor="auth-display-name"
                  className="block text-xs font-medium text-[var(--ink-secondary)] mb-1"
                >
                  Display Name
                </label>
                <Input
                  id="auth-display-name"
                  {...authForm.register("display_name")}
                  required
                />
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium text-[var(--ink-secondary)] mb-1"
              >
                Email
              </label>
              <Input
                id="auth-email"
                type="email"
                {...authForm.register("email")}
                required
              />
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block text-xs font-medium text-[var(--ink-secondary)] mb-1"
              >
                Password
              </label>
              <Input
                id="auth-password"
                type="password"
                {...authForm.register("password")}
                required
              />
            </div>

            {error && (
              <div className="p-2 rounded bg-[var(--danger-bg)] border border-[var(--danger-border)] text-xs text-[var(--danger)] break-words">
                {error}
              </div>
            )}

            <Button
              variant="human"
              size="md"
              type="submit"
              disabled={busy}
              className="w-full mt-2"
            >
              {busy
                ? "Connecting…"
                : mode === "login"
                  ? "Sign In"
                  : "Create Account"}
            </Button>
          </form>

          <div className="text-center pt-2 border-t border-[var(--hairline-subtle)] space-y-2">
            {REGISTRATION_ENABLED && (
              <button
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  setError("");
                }}
                className="text-xs text-[var(--ink-blue)] hover:underline cursor-pointer"
              >
                {mode === "login"
                  ? "Need an account? Register"
                  : "Already registered? Sign in"}
              </button>
            )}

            <p className="text-[11px] leading-relaxed text-[var(--ink-muted)]">
              AI actions send relevant workspace content to the configured external AI service.
            </p>

            <div>
              <button
                onClick={onExit}
                className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer"
              >
                ← Back to home
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const activeWorkspace =
    workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0] || null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--paper)] groundwork-app-root min-w-0">
      {/* Collapsible Left Sidebar */}
      <Sidebar
        auth={{ access_token: token, refresh_token: "", user }}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        nativeDocs={nativeDocs}
        activeDocId={activeNativeDocumentId}
        isOpen={isSidebarOpen}
        activeTheme={activeTheme}
        onToggleOpen={() => setIsSidebarOpen((v) => !v)}
        onSelectWorkspace={(wsId) => {
          navigateWithDraftGuard(() => {
            if (wsId !== activeWorkspaceId) setActiveNativeDocumentId(null);
            setActiveWorkspaceId(wsId);
            setWorkspaceView("workspace");
          });
        }}
        onSelectDoc={(docId) => {
          navigateWithDraftGuard(() => {
            const selectedDocument = nativeDocs.find(
              (document) => document.id === docId,
            );
            if (selectedDocument) {
              setActiveWorkspaceId(selectedDocument.workspace_id);
            }
            setActiveNativeDocumentId(docId);
            setWorkspaceView("workspace");
          });
        }}
        onCreateDoc={(workspaceId) => {
          navigateWithDraftGuard(() => {
            void handleCreateNativeDocument(
              workspaceId,
              "Response draft",
              documents
                .filter(
                  (document) =>
                    document.workspace_id === workspaceId &&
                    document.status === "ready",
                )
                .map((document) => document.id),
            );
          });
        }}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onOpenAccount={() => setAccountOpen(true)}
        onBackToLibrary={() =>
          navigateWithDraftGuard(() => setWorkspaceView("library"))
        }
        onToggleTheme={toggleTheme}
      />

      {/* Main View Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">
        {workspaceView === "workspace" && activeWorkspace ? (
          <ResearchWorkspace
            auth={{ access_token: token, refresh_token: "", user }}
            workspace={activeWorkspace}
            documents={documents}
            nativeDocs={nativeDocs}
            activeTheme={activeTheme}
            requestedDraftId={activeNativeDocumentId}
            onActiveDraftChange={setActiveNativeDocumentId}
            onDirtyStateChange={setHasUnsavedDraftChanges}
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
            onBackToLibrary={() =>
              navigateWithDraftGuard(() => setWorkspaceView("library"))
            }
            onUploadDocument={handleUploadWorkspaceDocument}
            onCreateDraft={(title, sourceDocumentIds) =>
              handleCreateNativeDocument(
                activeWorkspace.id,
                title,
                sourceDocumentIds,
              )
            }
            onDeleteDocument={async (docId) => {
              await api(`/documents/${docId}`, token, { method: "DELETE" });
              await loadDocuments(token);
            }}
            onOpenAccount={() => setAccountOpen(true)}
            onToggleTheme={toggleTheme}
            onOpenViewer={(docId, pageNumber, snippet) => {
              const doc = documents.find((d) => d.id === docId);
              if (doc) {
                setViewerPage(pageNumber || 1);
                setViewerSearch(snippet || "");
                setViewer(doc);
              }
            }}
          />
        ) : (
          <WorkspaceLibrary
            auth={{ access_token: token, refresh_token: "", user }}
            workspaces={workspaces}
            documents={documents}
            nativeDocs={nativeDocs}
            activeTheme={activeTheme}
            isSidebarOpen={isSidebarOpen}
            isLoading={isInitialLoading}
            createRequestKey={libraryCreateRequestKey}
            onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
            onSelectWorkspace={(wsId) => {
              setActiveNativeDocumentId(null);
              setActiveWorkspaceId(wsId);
              setWorkspaceView("workspace");
            }}
            onCreateWorkspace={handleCreateWorkspace}
            onDeleteWorkspace={handleDeleteWorkspace}
            onRenameWorkspace={handleRenameWorkspace}
            onUploadToNewWorkspace={async (file) => {
              const wsId = await handleCreateWorkspace(
                file.name.replace(/\.[^/.]+$/, ""),
              );
              if (wsId) await handleUploadWorkspaceDocument(file, wsId);
            }}
            onOpenAccount={() => setAccountOpen(true)}
            onToggleTheme={toggleTheme}
          />
        )}
      </div>

      {/* Dialog Overlays */}
      {viewer && (
        <PdfViewerModal
          document={viewer}
          token={token}
          initialPage={viewerPage}
          initialSearch={viewerSearch}
          onClose={() => setViewer(null)}
        />
      )}

      {accountOpen && (
        <AccountSettingsPanel
          user={user}
          token={token}
          stats={stats}
          onUser={(updated) => {
            setUser(updated);
            const saved = getStoredAuth();
            if (saved) setStoredAuth({ ...saved, user: updated });
          }}
          onClose={() => setAccountOpen(false)}
          onSignOut={signOut}
        />
      )}

      {notificationsOpen && (
        <NotificationCenter
          token={token}
          onClose={() => setNotificationsOpen(false)}
          onUnread={setNotificationUnread}
          onNavigate={() => setNotificationsOpen(false)}
        />
      )}

      {jobsOpen && (
        <ProcessingJobsModal token={token} onClose={() => setJobsOpen(false)} />
      )}

      {commandPaletteOpen && (
        <CommandPalette
          commands={workspaceCommands}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}

      <Modal
        isOpen={Boolean(pendingNavigation)}
        onClose={() => setPendingNavigation(null)}
        title="Discard unsaved changes?"
        eyebrow="Response draft"
        maxWidth="sm"
      >
        <div className="space-y-5">
          <p className="text-sm leading-relaxed text-[var(--ink-secondary)]">
            You have manual edits that have not been saved. Stay here to save
            them, or discard them and continue.
          </p>
          <div className="flex justify-end gap-2 border-t border-[var(--hairline)] pt-4">
            <Button
              variant="secondary"
              onClick={() => setPendingNavigation(null)}
            >
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const action = pendingNavigation;
                setPendingNavigation(null);
                setHasUnsavedDraftChanges(false);
                action?.();
              }}
            >
              Discard and continue
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default WorkspaceApp;
