import React, {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BarChart3,
  Bell,
  CheckCircle2,
  ChevronRight,
  Database,
  FileCog,
  LogOut,
  Shield,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
  Download,
  AlertTriangle,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { api, downloadTextFile } from "../../api/client";
import type {
  AdminUser,
  AuthResult,
  SecuritySession,
  Stats,
  UsageDetail,
  Workspace,
  WorkspaceMember,
} from "../../types";
import {
  applyPreferences,
  storedPreferences,
  type UserPreferences,
} from "./preferences";
import { useTranslation, type Language } from "../../i18n";

export type AccountTab =
  | "profile"
  | "security"
  | "defaults"
  | "notifications"
  | "privacy"
  | "usage"
  | "team"
  | "admin";

function Toggle({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  detail: string;
}) {
  return (
    <label className="settings-toggle flex items-center justify-between py-2 cursor-pointer group min-w-0">
      <div className="min-w-0 flex-1 pr-4">
        <strong className="block text-xs font-medium text-[var(--ink)] group-hover:text-[var(--ink-blue)] transition-colors truncate">
          {title}
        </strong>
        <p className="text-[11px] text-[var(--ink-secondary)] font-sans break-words">
          {detail}
        </p>
      </div>
      <div className="relative inline-flex items-center flex-shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <div
          className={`w-9 h-5 rounded-full transition-colors ${
            checked ? "bg-[var(--ink-blue)]" : "bg-[var(--hairline-strong)]"
          }`}
        >
          <div
            className={`w-3.5 h-3.5 mt-0.75 ml-0.75 rounded-full bg-white transition-transform ${
              checked ? "transform translate-x-4" : ""
            }`}
          />
        </div>
      </div>
    </label>
  );
}

function Heading({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="border-b border-[var(--hairline)] pb-4 mb-6 min-w-0">
      <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--ink-muted)] mb-1">
        {eyebrow}
      </p>
      <h2 className="font-serif text-xl sm:text-2xl font-bold text-[var(--ink)] tracking-tight">
        {title}
      </h2>
      <p className="text-xs text-[var(--ink-secondary)] mt-1 font-sans break-words">
        {detail}
      </p>
    </div>
  );
}

export function AccountPanel({
  user,
  token,
  stats,
  onUser,
  onClose,
  onSignOut,
}: {
  user: AuthResult["user"];
  token: string;
  stats: Stats | null;
  onUser: (user: AuthResult["user"]) => void;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const { language, setLanguage, languageOptions } = useTranslation();
  const [tab, setTab] = useState<AccountTab>("profile");

  const tabsList = useMemo<
    Array<{
      id: AccountTab;
      label: string;
      detail: string;
      icon: ReactNode;
      admin?: boolean;
    }>
  >(
    () => [
      {
        id: "profile",
        label: "Profile",
        detail: "Name, language & theme preferences",
        icon: <UserRound size={15} />,
      },
      {
        id: "security",
        label: "Security",
        detail: "Password & active device sessions",
        icon: <Shield size={15} />,
      },
      {
        id: "defaults",
        label: "Response Defaults",
        detail: "Tone, citation style & export format",
        icon: <FileCog size={15} />,
      },
      {
        id: "notifications",
        label: "Notifications",
        detail: "Task alerts & email preferences",
        icon: <Bell size={15} />,
      },
      {
        id: "privacy",
        label: "Privacy & Data",
        detail: "Data export, history & account retention",
        icon: <Database size={15} />,
      },
      {
        id: "usage",
        label: "Usage",
        detail: "Storage limits & AI token telemetry",
        icon: <BarChart3 size={15} />,
      },
      {
        id: "team",
        label: "Team",
        detail: "Collaborators & response roles",
        icon: <Users size={15} />,
      },
      {
        id: "admin",
        label: "Admin",
        detail: "Organization user management",
        icon: <ShieldCheck size={15} />,
        admin: true,
      },
    ],
    [],
  );

  const [preferences, setPreferences] =
    useState<UserPreferences>(storedPreferences);
  const [sessions, setSessions] = useState<SecuritySession[]>([]);
  const [usage, setUsage] = useState<UsageDetail | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const onUserRef = useRef(onUser);
  useEffect(() => {
    onUserRef.current = onUser;
  }, [onUser]);

  const loadMembers = useCallback(
    (selected: string) => {
      if (!selected) return Promise.resolve();
      return api<WorkspaceMember[]>(
        `/workspaces/${selected}/members`,
        token,
      ).then(setMembers);
    },
    [token],
  );

  useEffect(() => {
    Promise.all([
      api<AuthResult["user"]>("/auth/me", token).then((updated) =>
        onUserRef.current(updated),
      ),
      api<UserPreferences>("/profile/preferences", token).then((value) => {
        const local = storedPreferences();
        const isCurrentDark =
          document.documentElement.getAttribute("data-theme") === "dark";
        const merged: UserPreferences = {
          ...local,
          ...value,
          theme:
            isCurrentDark && value.theme === "light" && local.theme === "dark"
              ? "dark"
              : value.theme ||
                local.theme ||
                (isCurrentDark ? "dark" : "light"),
        };
        setPreferences(merged);
        applyPreferences(merged);
      }),
      api<Workspace[]>("/workspaces", token).then((items) => {
        setWorkspaces(items);
        const selected = items[0]?.id ?? "";
        setWorkspaceId(selected);
        return loadMembers(selected);
      }),
    ]).catch((reason) => setError(reason.message));
  }, [loadMembers, token]);

  useEffect(() => {
    if (tab === "security")
      api<SecuritySession[]>("/profile/sessions", token)
        .then(setSessions)
        .catch((reason) => setError(reason.message));
    if (tab === "usage")
      api<UsageDetail>("/profile/usage", token)
        .then(setUsage)
        .catch((reason) => setError(reason.message));
    if (tab === "admin" && user.role === "admin")
      api<AdminUser[]>("/admin/users", token)
        .then(setAdmins)
        .catch((reason) => setError(reason.message));
    if (tab === "team" && workspaceId)
      loadMembers(workspaceId).catch((reason) => setError(reason.message));
  }, [loadMembers, tab, token, user.role, workspaceId]);

  const selectTab = (next: AccountTab) => {
    setError("");
    setMessage("");
    setTab(next);
  };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const perform = async (work: () => Promise<void>, success?: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      if (success) setMessage(success);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  };

  async function savePreferences() {
    await perform(async () => {
      const updated = await api<UserPreferences>(
        "/profile/preferences",
        token,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preferences),
        },
      );
      setPreferences(updated);
      applyPreferences(updated);
    }, "Preferences saved successfully.");
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await perform(async () => {
      const updated = await api<AuthResult["user"]>("/profile", token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: form.get("display_name") }),
      });
      onUser(updated);
    }, "Profile updated.");
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await perform(async () => {
      await api("/profile/password", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: form.get("current_password"),
          new_password: form.get("new_password"),
        }),
      });
      formElement.reset();
      setSessions([]);
    }, "Password changed. Existing refresh sessions were revoked.");
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await perform(async () => {
      await api(`/workspaces/${workspaceId}/members`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          role: form.get("role"),
        }),
      });
      await loadMembers(workspaceId);
      formElement.reset();
    }, "Team member added and notified.");
  }

  async function exportData() {
    await perform(async () => {
      const value = await api<Record<string, unknown>>(
        "/profile/data-export",
        token,
      );
      downloadTextFile(
        `groundwork-account-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(value, null, 2),
        "application/json",
      );
    }, "Your account export was downloaded.");
  }

  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId);
  const editableTeam = selectedWorkspace?.role === "owner";
  const storagePercent = usage
    ? Math.min(
        100,
        Math.round((usage.storage_bytes / usage.storage_limit_bytes) * 100),
      )
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150 min-w-0"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl h-[88vh] max-h-[760px] bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-lg)] shadow-[var(--shadow-modal)] flex flex-col overflow-hidden account-panel account-panel-dialog min-w-0">
        {/* Top Header */}
        <header className="h-14 px-4 sm:px-6 border-b border-[var(--hairline)] bg-[var(--paper)] flex items-center justify-between flex-shrink-0 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[var(--ink-blue)] text-white font-mono text-xs font-bold flex items-center justify-center flex-shrink-0 shadow-[var(--shadow-subtle)]">
              {user.display_name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-serif text-sm font-bold text-[var(--ink)] truncate">
                  {user.display_name}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--paper-subtle)] text-[var(--ink-muted)] border border-[var(--hairline)] flex-shrink-0">
                  {user.role === "admin" ? "Administrator" : "Member"}
                </span>
              </div>
              <p className="text-[11px] font-mono text-[var(--ink-muted)] truncate">
                {user.email}
              </p>
            </div>
          </div>

          <Button
            variant="ghost"
            size="xs"
            onClick={onClose}
            className="text-[var(--ink-muted)] hover:text-[var(--ink)] flex-shrink-0 h-8 w-8 p-0"
            title="Close account settings"
            aria-label="Close account settings"
          >
            <X size={16} />
          </Button>
        </header>

        {/* 2-Column Notion-Style Layout */}
        <div className="flex-1 flex overflow-hidden min-w-0">
          {/* Left Navigation Sidebar */}
          <aside className="w-56 sm:w-64 flex-shrink-0 border-r border-[var(--hairline)] bg-[var(--paper)] p-3 flex flex-col justify-between select-none account-settings-nav min-w-0">
            <nav className="space-y-1 overflow-y-auto min-w-0 flex-1">
              {tabsList
                .filter((item) => !item.admin || user.role === "admin")
                .map((item) => {
                  const isActive = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectTab(item.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-sm)] text-left transition-all text-xs group cursor-pointer min-w-0 ${
                        isActive
                          ? "bg-[var(--surface)] text-[var(--ink-blue)] font-semibold shadow-[var(--shadow-subtle)] border border-[var(--ink-blue-border)]"
                          : "text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] border border-transparent"
                      }`}
                    >
                      <span
                        className={`flex-shrink-0 ${
                          isActive
                            ? "text-[var(--ink-blue)]"
                            : "text-[var(--ink-muted)] group-hover:text-[var(--ink)]"
                        }`}
                      >
                        {item.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="truncate leading-none">{item.label}</p>
                      </div>
                      <ChevronRight
                        size={12}
                        className={`flex-shrink-0 transition-transform ${
                          isActive
                            ? "text-[var(--ink-blue)] translate-x-0.5"
                            : "opacity-0 group-hover:opacity-40"
                        }`}
                      />
                    </button>
                  );
                })}
            </nav>

            {/* Sign Out Action */}
            <div className="pt-3 border-t border-[var(--hairline)] min-w-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={onSignOut}
                className="w-full justify-start text-[var(--danger)] hover:bg-[var(--danger-bg)] text-xs"
              >
                <LogOut size={14} className="flex-shrink-0" />
                <span>Sign Out</span>
              </Button>
            </div>
          </aside>

          {/* Right Main Settings Pane */}
          <main className="flex-1 overflow-y-auto p-4 sm:p-8 bg-[var(--surface)] min-w-0 space-y-6">
            {error && (
              <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--danger-bg)] border border-[var(--danger-border)] text-xs text-[var(--danger)] flex items-center gap-2 break-words">
                <AlertTriangle size={14} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {message && (
              <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--success-bg)] border border-[var(--success-border)] text-xs text-[var(--success)] flex items-center gap-2 break-words">
                <CheckCircle2 size={14} className="flex-shrink-0" />
                <span>{message}</span>
              </div>
            )}

            {/* TAB: PROFILE */}
            {tab === "profile" && (
              <div className="space-y-6 min-w-0">
                <Heading
                  eyebrow="Account Settings"
                  title="Profile & Appearance"
                  detail="Manage your personal identity, display preferences, language, and interface theme."
                />

                {/* Identity Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
                  <div className="p-4 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-full bg-[var(--ink-blue)] text-white font-mono text-sm font-bold flex items-center justify-center flex-shrink-0">
                      {user.display_name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-serif text-sm font-bold text-[var(--ink)] truncate">
                        {user.display_name}
                      </h4>
                      <p className="text-xs text-[var(--ink-muted)] font-mono truncate">
                        {user.email}
                      </p>
                      <span className="inline-block mt-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface)] text-[var(--ink-secondary)] border border-[var(--hairline)]">
                        {user.role === "admin" ? "Administrator" : "Member"}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] flex items-center justify-between gap-3 min-w-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CheckCircle2
                        size={18}
                        className={
                          user.google_linked
                            ? "text-[var(--success)]"
                            : "text-[var(--ink-faint)]"
                        }
                      />
                      <div className="min-w-0">
                        <h4 className="font-serif text-xs font-bold text-[var(--ink)] truncate">
                          Google Authentication
                        </h4>
                        <p className="text-[11px] text-[var(--ink-muted)]">
                          {user.google_linked
                            ? "Connected for single sign-on"
                            : "Not connected to account"}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded flex-shrink-0 ${
                        user.google_linked
                          ? "bg-[var(--success-bg)] text-[var(--success)] font-semibold"
                          : "bg-[var(--paper-subtle)] text-[var(--ink-muted)]"
                      }`}
                    >
                      {user.google_linked ? "Connected" : "Unlinked"}
                    </span>
                  </div>
                </div>

                {/* Personal Information Form */}
                <form
                  onSubmit={updateProfile}
                  className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] space-y-4 min-w-0"
                >
                  <div>
                    <h3 className="font-serif text-sm font-bold text-[var(--ink)]">
                      Personal Information
                    </h3>
                    <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                      This display name appears across shared bid responses and
                      their revision history.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                        Display name
                      </label>
                      <Input
                        name="display_name"
                        defaultValue={user.display_name}
                        minLength={2}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                        Email address
                      </label>
                      <Input
                        value={user.email}
                        disabled
                        className="opacity-60 cursor-not-allowed font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <Button
                      variant="human"
                      size="sm"
                      type="submit"
                      disabled={busy}
                    >
                      Save profile
                    </Button>
                  </div>
                </form>

                {/* Language & Appearance */}
                <section className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] space-y-4 min-w-0">
                  <div>
                    <h3 className="font-serif text-sm font-bold text-[var(--ink)]">
                      Language & Interface Theme
                    </h3>
                    <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                      Choose your UI localization and switch between light and
                      dark manuscript themes.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                        Interface language
                      </label>
                      <select
                        value={preferences.language || language || "en"}
                        onChange={async (e) => {
                          const nextLang = e.target.value as Language;
                          const updated = {
                            ...preferences,
                            language: nextLang,
                          };
                          setPreferences(updated);
                          applyPreferences(updated);
                          setLanguage(nextLang);
                          await perform(async () => {
                            await api<UserPreferences>(
                              "/profile/preferences",
                              token,
                              {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(updated),
                              },
                            );
                          }, "Language updated.");
                        }}
                        className="w-full h-9 px-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] font-sans"
                      >
                        {languageOptions.map((opt) => (
                          <option key={opt.code} value={opt.code}>
                            {opt.flag} {opt.nativeName} ({opt.label})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                        Color theme
                      </label>
                      <select
                        value={preferences.theme}
                        onChange={async (e) => {
                          const nextTheme = e.target
                            .value as UserPreferences["theme"];
                          const updated = { ...preferences, theme: nextTheme };
                          setPreferences(updated);
                          applyPreferences(updated);
                          await perform(async () => {
                            await api<UserPreferences>(
                              "/profile/preferences",
                              token,
                              {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(updated),
                              },
                            );
                          }, "Theme preference saved.");
                        }}
                        className="w-full h-9 px-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] font-sans"
                      >
                        <option value="light">Light Manuscript</option>
                        <option value="dark">Dark Slate</option>
                        <option value="system">Follow System Preference</option>
                      </select>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* TAB: SECURITY */}
            {tab === "security" && (
              <div className="space-y-6 min-w-0">
                <Heading
                  eyebrow="Security & Access"
                  title="Password & Active Sessions"
                  detail="Manage account credentials and revoke unrecognized device sessions."
                />

                {/* Change Password */}
                <form
                  onSubmit={changePassword}
                  className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] space-y-4 min-w-0"
                >
                  <h3 className="font-serif text-sm font-bold text-[var(--ink)]">
                    Change Password
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                        Current password
                      </label>
                      <Input
                        name="current_password"
                        type="password"
                        autoComplete="current-password"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                        New password
                      </label>
                      <Input
                        name="new_password"
                        type="password"
                        autoComplete="new-password"
                        minLength={8}
                        required
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <Button
                      variant="human"
                      size="sm"
                      type="submit"
                      disabled={busy}
                    >
                      Update password
                    </Button>
                  </div>
                </form>

                {/* Active Sessions */}
                <section className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] space-y-4 min-w-0">
                  <div className="flex items-center justify-between min-w-0">
                    <div>
                      <h3 className="font-serif text-sm font-bold text-[var(--ink)]">
                        Active Device Sessions
                      </h3>
                      <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                        Sessions are created when you sign in or refresh your
                        secure access token.
                      </p>
                    </div>

                    {sessions.length > 0 && (
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() =>
                          perform(async () => {
                            await api("/profile/sessions/revoke-all", token, {
                              method: "POST",
                            });
                            onSignOut();
                          })
                        }
                        className="flex-shrink-0"
                      >
                        Sign out everywhere
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2 min-w-0">
                    {sessions.map((session, index) => (
                      <div
                        key={session.id}
                        className="p-3 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--hairline)] flex items-center justify-between gap-3 text-xs min-w-0"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Shield
                            size={16}
                            className="text-[var(--ink-blue)] flex-shrink-0"
                          />
                          <div className="min-w-0">
                            <strong className="block font-medium text-[var(--ink)] truncate">
                              {index === 0
                                ? "Current active session"
                                : "Signed-in session"}
                            </strong>
                            <p className="text-[11px] font-mono text-[var(--ink-muted)] truncate">
                              Started{" "}
                              {new Date(session.created_at).toLocaleString()} ·
                              Expires{" "}
                              {new Date(
                                session.expires_at,
                              ).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() =>
                            perform(async () => {
                              await api(
                                `/profile/sessions/${session.id}`,
                                token,
                                { method: "DELETE" },
                              );
                              setSessions((current) =>
                                current.filter(
                                  (item) => item.id !== session.id,
                                ),
                              );
                            }, "Session revoked.")
                          }
                          className="text-[var(--danger)] hover:bg-[var(--danger-bg)] flex-shrink-0"
                        >
                          Revoke
                        </Button>
                      </div>
                    ))}

                    {sessions.length === 0 && (
                      <p className="text-xs text-[var(--ink-muted)] text-center py-4">
                        No active refresh sessions stored.
                      </p>
                    )}
                  </div>
                </section>
              </div>
            )}

            {/* TAB: DOCUMENT DEFAULTS */}
            {tab === "defaults" && (
              <div className="space-y-6 min-w-0">
                <Heading
                  eyebrow="Response Defaults"
                  title="Response & Writing Defaults"
                  detail="Set the language, tone, citations, and export format used for new responses."
                />

                <section className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] space-y-4 min-w-0">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 min-w-0">
                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                        Writing language
                      </label>
                      <select
                        value={preferences.document_language}
                        onChange={(e) =>
                          setPreferences({
                            ...preferences,
                            document_language: e.target.value,
                          })
                        }
                        className="w-full h-9 px-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] font-sans"
                      >
                        <option>English</option>
                        <option>Vietnamese</option>
                        <option>Spanish</option>
                        <option>Japanese</option>
                        <option>German</option>
                        <option>French</option>
                        <option>Chinese (Simplified)</option>
                        <option>Korean</option>
                        <option>Portuguese</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                        Default tone
                      </label>
                      <select
                        value={preferences.default_tone}
                        onChange={(e) =>
                          setPreferences({
                            ...preferences,
                            default_tone: e.target
                              .value as UserPreferences["default_tone"],
                          })
                        }
                        className="w-full h-9 px-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] font-sans"
                      >
                        <option value="professional">Professional</option>
                        <option value="concise">Concise</option>
                        <option value="technical">Technical</option>
                        <option value="academic">Academic</option>
                        <option value="friendly">Friendly</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                        Citation style
                      </label>
                      <select
                        value={preferences.citation_style}
                        onChange={(e) =>
                          setPreferences({
                            ...preferences,
                            citation_style: e.target
                              .value as UserPreferences["citation_style"],
                          })
                        }
                        className="w-full h-9 px-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] font-sans"
                      >
                        <option value="inline">Inline source links</option>
                        <option value="footnote">Footnotes</option>
                        <option value="apa">APA</option>
                        <option value="mla">MLA</option>
                        <option value="chicago">Chicago</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                        Page size
                      </label>
                      <select
                        value={preferences.page_size}
                        onChange={(e) =>
                          setPreferences({
                            ...preferences,
                            page_size: e.target
                              .value as UserPreferences["page_size"],
                          })
                        }
                        className="w-full h-9 px-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] font-sans"
                      >
                        <option value="a4">A4</option>
                        <option value="letter">US Letter</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                        Default export
                      </label>
                      <select
                        value={preferences.default_export_format}
                        onChange={(e) =>
                          setPreferences({
                            ...preferences,
                            default_export_format: e.target
                              .value as UserPreferences["default_export_format"],
                          })
                        }
                        className="w-full h-9 px-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] font-sans"
                      >
                        <option value="pdf">PDF</option>
                        <option value="docx">Word (DOCX)</option>
                        <option value="markdown">Markdown</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <Button
                      variant="human"
                      size="sm"
                      onClick={savePreferences}
                      disabled={busy}
                    >
                      Save document defaults
                    </Button>
                  </div>
                </section>
              </div>
            )}

            {/* TAB: NOTIFICATIONS */}
            {tab === "notifications" && (
              <div className="space-y-6 min-w-0">
                <Heading
                  eyebrow="Notifications"
                  title="Alerts & Background Activity"
                  detail="Groundwork preserves a durable notification inbox so you can leave asynchronous drafting and return when it is ready."
                />

                <section className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] space-y-3 min-w-0">
                  <Toggle
                    checked={preferences.notify_processing_completed}
                    onChange={(v) =>
                      setPreferences({
                        ...preferences,
                        notify_processing_completed: v,
                      })
                    }
                    title="Completed processing and exports"
                    detail="Notify me when source uploads, AI tasks, and response exports finish."
                  />
                  <div className="border-t border-[var(--hairline-subtle)]" />
                  <Toggle
                    checked={preferences.notify_processing_failed}
                    onChange={(v) =>
                      setPreferences({
                        ...preferences,
                        notify_processing_failed: v,
                      })
                    }
                    title="Failures that need attention"
                    detail="Surface errors and actionable recovery paths for document indexing or OCR issues."
                  />
                  <div className="border-t border-[var(--hairline-subtle)]" />
                  <Toggle
                    checked={preferences.notify_comments}
                    onChange={(v) =>
                      setPreferences({ ...preferences, notify_comments: v })
                    }
                    title="Team comments"
                    detail="Notify me when a team collaborator comments or annotates a draft section."
                  />
                  <div className="border-t border-[var(--hairline-subtle)]" />
                  <Toggle
                    checked={preferences.notify_reviews}
                    onChange={(v) =>
                      setPreferences({ ...preferences, notify_reviews: v })
                    }
                    title="AI review results"
                    detail="Alert when review findings, unsupported claims, and readiness gates are updated."
                  />

                  <div className="pt-3 border-t border-[var(--hairline)] flex justify-end">
                    <Button
                      variant="human"
                      size="sm"
                      onClick={savePreferences}
                      disabled={busy}
                    >
                      Save notification settings
                    </Button>
                  </div>
                </section>
              </div>
            )}

            {/* TAB: PRIVACY & DATA */}
            {tab === "privacy" && (
              <div className="space-y-6 min-w-0">
                <Heading
                  eyebrow="Privacy & Data"
                  title="Data Retention & Privacy Controls"
                  detail="Download your account data, manage response activity retention, or purge history."
                />

                <section className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] space-y-4 min-w-0">
                  <Toggle
                    checked={preferences.retain_activity_history}
                    onChange={(v) =>
                      setPreferences({
                        ...preferences,
                        retain_activity_history: v,
                      })
                    }
                    title="Keep activity history"
                    detail="Retain revision timelines and citation verification history across responses."
                  />

                  <div>
                    <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                      Retain history for
                    </label>
                    <select
                      value={preferences.retention_days}
                      onChange={(e) =>
                        setPreferences({
                          ...preferences,
                          retention_days: Number(e.target.value),
                        })
                      }
                      className="w-full sm:w-64 h-9 px-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] font-sans"
                    >
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                      <option value={365}>1 year</option>
                      <option value={3650}>10 years</option>
                    </select>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <Button
                      variant="human"
                      size="sm"
                      onClick={savePreferences}
                      disabled={busy}
                    >
                      Save retention settings
                    </Button>
                  </div>
                </section>

                {/* Data Actions & Danger Zone */}
                <section className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] space-y-4 min-w-0">
                  <h3 className="font-serif text-sm font-bold text-[var(--ink)]">
                    Data Actions & Exports
                  </h3>

                  <div className="space-y-3 min-w-0">
                    <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--hairline)] flex items-center justify-between gap-3 text-xs min-w-0">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Database
                          size={16}
                          className="text-[var(--ink-blue)] flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <strong className="block font-medium text-[var(--ink)] truncate">
                            Download account data
                          </strong>
                          <p className="text-[11px] text-[var(--ink-muted)]">
                            Export your profile, preferences, workspace list,
                            and usage summary as JSON.
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={exportData}
                        className="flex-shrink-0"
                      >
                        <Download size={11} />
                        <span>Download</span>
                      </Button>
                    </div>

                    <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--hairline)] flex items-center justify-between gap-3 text-xs min-w-0">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Trash2
                          size={16}
                          className="text-[var(--warning)] flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <strong className="block font-medium text-[var(--ink)] truncate">
                            Clear activity and AI history
                          </strong>
                          <p className="text-[11px] text-[var(--ink-muted)]">
                            Removes conversations, AI results, usage records,
                            and authored notifications.
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => {
                          const confirmation = window.prompt(
                            'Type "clear history" to continue',
                          );
                          if (confirmation) {
                            perform(
                              async () =>
                                api("/profile/history", token, {
                                  method: "DELETE",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({ confirmation }),
                                }),
                              "Account history cleared.",
                            );
                          }
                        }}
                        className="text-[var(--warning)] hover:bg-[var(--warning-bg)] flex-shrink-0"
                      >
                        Clear history
                      </Button>
                    </div>

                    <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--danger-bg)] border border-[var(--danger-border)] flex items-center justify-between gap-3 text-xs min-w-0">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <AlertTriangle
                          size={16}
                          className="text-[var(--danger)] flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <strong className="block font-medium text-[var(--danger)] truncate">
                            Delete Groundwork account
                          </strong>
                          <p className="text-[11px] text-[var(--danger)] opacity-80">
                            Permanently purges your account, response workspaces,
                            and stored files. This cannot be undone.
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="danger"
                        size="xs"
                        onClick={() => {
                          const confirmation = window.prompt(
                            `Type ${user.email} to permanently delete your account`,
                          );
                          if (confirmation) {
                            perform(async () => {
                              await api("/profile/account", token, {
                                method: "DELETE",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ confirmation }),
                              });
                              onSignOut();
                            });
                          }
                        }}
                        className="flex-shrink-0"
                      >
                        Delete account
                      </Button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* TAB: USAGE */}
            {tab === "usage" && (
              <div className="space-y-6 min-w-0">
                <Heading
                  eyebrow="Usage Telemetry"
                  title="Storage & AI Activity"
                  detail="Monitor source volume, indexed pages, background tasks, and AI usage."
                />

                {/* Top Metrics Cards */}
                {stats && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 min-w-0">
                    <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--paper)] border border-[var(--hairline)] text-center min-w-0">
                      <strong className="block font-mono text-xl font-bold text-[var(--ink)]">
                        {stats.document_count}
                      </strong>
                      <span className="text-[11px] text-[var(--ink-muted)]">
                        Documents
                      </span>
                    </div>

                    <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--paper)] border border-[var(--hairline)] text-center min-w-0">
                      <strong className="block font-mono text-xl font-bold text-[var(--ink)]">
                        {stats.page_count}
                      </strong>
                      <span className="text-[11px] text-[var(--ink-muted)]">
                        Pages indexed
                      </span>
                    </div>

                    <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--paper)] border border-[var(--hairline)] text-center min-w-0">
                      <strong className="block font-mono text-xl font-bold text-[var(--ink)]">
                        {stats.generated_files}
                      </strong>
                      <span className="text-[11px] text-[var(--ink-muted)]">
                        Generated files
                      </span>
                    </div>

                    <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--paper)] border border-[var(--hairline)] text-center min-w-0">
                      <strong
                        className={`block font-mono text-xl font-bold ${
                          stats.failed_jobs
                            ? "text-[var(--danger)]"
                            : "text-[var(--ink)]"
                        }`}
                      >
                        {stats.failed_jobs}
                      </strong>
                      <span className="text-[11px] text-[var(--ink-muted)]">
                        Failed jobs
                      </span>
                    </div>
                  </div>
                )}

                {/* Storage & Breakdown */}
                {usage && (
                  <>
                    <section className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] space-y-3 min-w-0">
                      <div className="flex items-center justify-between min-w-0">
                        <h3 className="font-serif text-sm font-bold text-[var(--ink)]">
                          Storage Allocation
                        </h3>
                        <strong className="font-mono text-xs text-[var(--ink)]">
                          {(usage.storage_bytes / 1024 / 1024).toFixed(1)} MB of{" "}
                          {(
                            usage.storage_limit_bytes /
                            1024 /
                            1024 /
                            1024
                          ).toFixed(0)}{" "}
                          GB
                        </strong>
                      </div>

                      <div className="w-full h-2 rounded-full bg-[rgba(0,0,0,0.08)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--ink-blue)] transition-all"
                          style={{ width: `${storagePercent}%` }}
                        />
                      </div>
                      <p className="text-[11px] font-mono text-[var(--ink-muted)]">
                        {storagePercent}% used
                      </p>
                    </section>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
                      <section className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] space-y-3 min-w-0">
                        <h3 className="font-serif text-sm font-bold text-[var(--ink)]">
                          AI Activity
                        </h3>
                        <div className="p-2.5 rounded bg-[var(--surface)] border border-[var(--hairline)] font-mono text-xs">
                          <strong className="text-base text-[var(--ink-sepia)] font-bold">
                            {usage.ai_requests_30_days}
                          </strong>{" "}
                          <span className="text-[var(--ink-muted)]">
                            requests in the last 30 days
                          </span>
                        </div>

                        <div className="space-y-1.5 min-w-0">
                          {Object.entries(usage.ai_requests_by_feature)
                            .sort((a, b) => b[1] - a[1])
                            .map(([key, value]) => (
                              <div
                                key={key}
                                className="flex items-center justify-between text-xs font-mono py-1 border-b border-[var(--hairline-subtle)]"
                              >
                                <span className="text-[var(--ink-secondary)] capitalize">
                                  {key.replaceAll("_", " ")}
                                </span>
                                <strong className="text-[var(--ink)]">
                                  {value}
                                </strong>
                              </div>
                            ))}
                          {!Object.keys(usage.ai_requests_by_feature)
                            .length && (
                            <p className="text-xs text-[var(--ink-muted)]">
                              No AI activity yet.
                            </p>
                          )}
                        </div>
                      </section>

                      <section className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] space-y-3 min-w-0">
                        <h3 className="font-serif text-sm font-bold text-[var(--ink)]">
                          Background Tasks
                        </h3>
                        <div className="space-y-1.5 min-w-0">
                          {Object.entries(usage.jobs_by_status).map(
                            ([key, value]) => (
                              <div
                                key={key}
                                className="flex items-center justify-between text-xs font-mono py-1 border-b border-[var(--hairline-subtle)]"
                              >
                                <span className="job-state capitalize text-[var(--ink-secondary)]">
                                  {key}
                                </span>
                                <strong className="text-[var(--ink)]">
                                  {value}
                                </strong>
                              </div>
                            ),
                          )}
                          {!Object.keys(usage.jobs_by_status).length && (
                            <p className="text-xs text-[var(--ink-muted)]">
                              No jobs active.
                            </p>
                          )}
                        </div>
                      </section>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* TAB: TEAM */}
            {tab === "team" && (
              <div className="space-y-6 min-w-0">
                <Heading
                  eyebrow="Team Access"
                  title="Response Collaboration"
                  detail="Invite collaborators to bid responses and assign editor or viewer roles."
                />

                <section className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] space-y-4 min-w-0">
                  <div>
                    <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                      Response
                    </label>
                    <select
                      value={workspaceId}
                      onChange={(e) => setWorkspaceId(e.target.value)}
                      className="w-full h-9 px-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] font-sans"
                    >
                      {workspaces.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.role}
                        </option>
                      ))}
                    </select>
                  </div>

                  {editableTeam && (
                    <form
                      onSubmit={inviteMember}
                      className="space-y-3 pt-2 border-t border-[var(--hairline-subtle)] min-w-0"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 min-w-0">
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-medium text-[var(--ink-secondary)] mb-1">
                            Member email
                          </label>
                          <Input
                            name="email"
                            type="email"
                            placeholder="teammate@company.com"
                            required
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-[var(--ink-secondary)] mb-1">
                            Access Role
                          </label>
                          <select
                            name="role"
                            defaultValue="editor"
                            className="w-full h-9 px-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] font-sans"
                          >
                            <option value="editor">Editor</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <Button variant="human" size="sm" disabled={busy}>
                          Add member
                        </Button>
                      </div>
                    </form>
                  )}
                </section>

                {/* Members List */}
                <section className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] space-y-4 min-w-0">
                  <div className="flex items-center justify-between min-w-0">
                    <h3 className="font-serif text-sm font-bold text-[var(--ink)]">
                      Workspace Members
                    </h3>
                    <span className="text-xs font-mono text-[var(--ink-muted)]">
                      {members.length} people have access
                    </span>
                  </div>

                  <div className="space-y-2 min-w-0">
                    {members.map((member) => (
                      <div
                        key={member.id}
                        className="p-3 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--hairline)] flex items-center justify-between gap-3 text-xs min-w-0"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-[var(--paper-subtle)] border border-[var(--hairline)] font-mono text-xs font-bold flex items-center justify-center text-[var(--ink)] flex-shrink-0">
                            {member.display_name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <strong className="block font-medium text-[var(--ink)] truncate">
                              {member.display_name}
                              {member.user_id === user.id ? " (you)" : ""}
                            </strong>
                            <p className="text-[11px] font-mono text-[var(--ink-muted)] truncate">
                              {member.email}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {member.role === "owner" || !editableTeam ? (
                            <span className="font-mono text-xs uppercase px-2 py-0.5 rounded bg-[var(--paper-subtle)] text-[var(--ink-muted)]">
                              {member.role}
                            </span>
                          ) : (
                            <>
                              <select
                                value={member.role}
                                onChange={(e) =>
                                  perform(async () => {
                                    const updated = await api<WorkspaceMember>(
                                      `/workspaces/${workspaceId}/members/${member.id}`,
                                      token,
                                      {
                                        method: "PATCH",
                                        headers: {
                                          "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({
                                          role: e.target.value,
                                        }),
                                      },
                                    );
                                    setMembers((current) =>
                                      current.map((item) =>
                                        item.id === updated.id ? updated : item,
                                      ),
                                    );
                                  }, "Member access updated.")
                                }
                                className="h-7 px-2 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)]"
                              >
                                <option value="editor">Editor</option>
                                <option value="viewer">Viewer</option>
                              </select>

                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Remove ${member.display_name} from this workspace?`,
                                    )
                                  ) {
                                    perform(async () => {
                                      await api(
                                        `/workspaces/${workspaceId}/members/${member.id}`,
                                        token,
                                        { method: "DELETE" },
                                      );
                                      setMembers((current) =>
                                        current.filter(
                                          (item) => item.id !== member.id,
                                        ),
                                      );
                                    }, "Member removed.");
                                  }
                                }}
                                className="text-[var(--danger)] hover:bg-[var(--danger-bg)]"
                              >
                                Remove
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* TAB: ADMIN */}
            {tab === "admin" && user.role === "admin" && (
              <div className="space-y-6 min-w-0">
                <Heading
                  eyebrow="Admin Portal"
                  title="User Management & Audit"
                  detail="Review registered accounts across your organization, monitor usage volume, and manage credentials."
                />

                <section className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--hairline)] space-y-4 admin-users min-w-0">
                  <div className="flex items-center justify-between min-w-0">
                    <h3 className="font-serif text-sm font-bold text-[var(--ink)]">
                      All Registered Users
                    </h3>
                    <span className="text-xs font-mono text-[var(--ink-muted)]">
                      {admins.length} accounts
                    </span>
                  </div>

                  <div className="space-y-2 min-w-0">
                    {admins.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--hairline)] flex items-center justify-between gap-3 text-xs min-w-0"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] font-mono text-xs font-bold flex items-center justify-center flex-shrink-0">
                            {item.display_name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <strong className="font-medium text-[var(--ink)] truncate">
                                {item.display_name}
                              </strong>
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--paper-subtle)] text-[var(--ink-muted)]">
                                {item.role}
                              </span>
                            </div>
                            <p className="text-[11px] font-mono text-[var(--ink-muted)] truncate">
                              {item.email} · {item.document_count} docs ·{" "}
                              {item.ai_requests} AI requests
                            </p>
                          </div>
                        </div>

                        <Button
                          variant={item.is_active ? "danger" : "secondary"}
                          size="xs"
                          disabled={item.id === user.id}
                          onClick={() =>
                            perform(
                              async () => {
                                const updated = await api<AuthResult["user"]>(
                                  `/admin/users/${item.id}/status`,
                                  token,
                                  {
                                    method: "PATCH",
                                    headers: {
                                      "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({
                                      is_active: !item.is_active,
                                    }),
                                  },
                                );
                                setAdmins((current) =>
                                  current.map((value) =>
                                    value.id === item.id
                                      ? {
                                          ...value,
                                          is_active: updated.is_active,
                                        }
                                      : value,
                                  ),
                                );
                              },
                              `Account ${item.is_active ? "disabled" : "enabled"}.`,
                            )
                          }
                          className="flex-shrink-0"
                        >
                          {item.id === user.id
                            ? "Current user"
                            : item.is_active
                              ? "Disable"
                              : "Enable"}
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default AccountPanel;
