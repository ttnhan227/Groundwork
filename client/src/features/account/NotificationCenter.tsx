import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  Clock3,
  Info,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../../api/client";
import type { Job, NotificationItem } from "../../types";
import { Button } from "../../components/ui/Button";

type Filter = "all" | "unread" | "attention";

function NotificationIcon({
  severity,
}: {
  severity: NotificationItem["severity"];
}) {
  if (severity === "error")
    return <AlertTriangle size={15} className="text-[var(--danger)]" />;
  if (severity === "warning")
    return <AlertTriangle size={15} className="text-[var(--warning)]" />;
  if (severity === "success")
    return <CheckCircle2 size={15} className="text-[var(--success)]" />;
  return <Info size={15} className="text-[var(--ink-blue)]" />;
}

export function NotificationCenter({
  token,
  onClose,
  onUnread,
  onNavigate,
}: {
  token: string;
  onClose: () => void;
  onUnread: (count: number) => void;
  onNavigate: (action: string | null) => void;
}) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [notifications, allJobs] = await Promise.all([
        api<NotificationItem[]>("/notifications?limit=100", token),
        api<Job[]>("/jobs", token),
      ]);
      setItems(notifications);
      setJobs(
        allJobs.filter((job) => ["queued", "running"].includes(job.status)),
      );
      onUnread(notifications.filter((item) => !item.read_at).length);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load notifications",
      );
    }
  }, [onUnread, token]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const initial = window.setTimeout(load, 0);
    const timer = window.setInterval(load, 3000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  const visible = useMemo(
    () =>
      items.filter((item) => {
        if (filter === "unread") return !item.read_at;
        if (filter === "attention")
          return ["error", "warning"].includes(item.severity);
        return true;
      }),
    [filter, items],
  );

  async function markRead(item: NotificationItem) {
    if (!item.read_at) {
      const updated = await api<NotificationItem>(
        `/notifications/${item.id}/read`,
        token,
        {
          method: "PATCH",
        },
      );
      setItems((current) =>
        current.map((value) => (value.id === item.id ? updated : value)),
      );
      onUnread(Math.max(0, items.filter((value) => !value.read_at).length - 1));
    }
    onNavigate(item.action);
  }

  async function markAllRead() {
    await api("/notifications/read-all", token, { method: "POST" });
    const timestamp = new Date().toISOString();
    setItems((current) =>
      current.map((item) => ({ ...item, read_at: item.read_at ?? timestamp })),
    );
    onUnread(0);
  }

  async function remove(item: NotificationItem) {
    await api(`/notifications/${item.id}`, token, { method: "DELETE" });
    const remaining = items.filter((value) => value.id !== item.id);
    setItems(remaining);
    onUnread(remaining.filter((value) => !value.read_at).length);
  }

  const unread = items.filter((item) => !item.read_at).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150 min-w-0"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg max-h-[85vh] bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-lg)] shadow-[var(--shadow-modal)] flex flex-col overflow-hidden notification-panel min-w-0">
        {/* Header */}
        <header className="h-14 px-4 sm:px-5 border-b border-[var(--hairline)] bg-[var(--paper)] flex items-center justify-between flex-shrink-0 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-full bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] flex items-center justify-center flex-shrink-0">
              <Bell size={14} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--ink-muted)]">
                Activity center
              </p>
              <h2 className="font-serif text-sm font-bold text-[var(--ink)] leading-none truncate">
                Notifications
              </h2>
            </div>
          </div>

          <Button
            variant="ghost"
            size="xs"
            onClick={onClose}
            className="text-[var(--ink-muted)] hover:text-[var(--ink)] h-7 w-7 p-0 flex-shrink-0"
            aria-label="Close notifications"
          >
            <X size={15} />
          </Button>
        </header>

        {/* Live Active Jobs Banner */}
        {jobs.length > 0 && (
          <div className="p-3 bg-[var(--paper-subtle)] border-b border-[var(--hairline)] space-y-2 min-w-0">
            <div className="flex items-center justify-between text-xs font-mono text-[var(--ink-sepia)] font-semibold min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--ink-sepia)] animate-pulse flex-shrink-0" />
                <span className="truncate">Live now</span>
              </div>
              <span className="text-[10px] text-[var(--ink-muted)]">
                {jobs.length} active
              </span>
            </div>

            {jobs.map((job) => (
              <div
                key={job.id}
                className="p-2 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--hairline)] text-xs flex items-center justify-between gap-3 min-w-0"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <RefreshCw
                    size={13}
                    className="spin text-[var(--ink-sepia)] flex-shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <strong className="block font-medium text-[var(--ink)] truncate">
                      {(job.operation ?? "Document processing").replaceAll(
                        "_",
                        " ",
                      )}
                    </strong>
                    <div className="w-full h-1 rounded-full bg-[rgba(0,0,0,0.08)] overflow-hidden mt-1">
                      <div
                        className="h-full bg-[var(--ink-sepia)] rounded-full transition-all"
                        style={{ width: `${Math.max(4, job.progress)}%` }}
                      />
                    </div>
                  </div>
                </div>
                <span className="font-mono text-[11px] text-[var(--ink-muted)] flex-shrink-0">
                  {job.progress}%
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Filter Navigation Bar */}
        <div className="px-4 py-2 border-b border-[var(--hairline)] flex items-center justify-between gap-2 text-xs min-w-0 bg-[var(--surface)]">
          <div className="flex items-center gap-1 font-sans min-w-0">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`px-2 py-1 rounded-[var(--radius-sm)] transition-colors cursor-pointer text-xs ${
                filter === "all"
                  ? "bg-[var(--paper-subtle)] text-[var(--ink)] font-semibold"
                  : "text-[var(--ink-secondary)] hover:text-[var(--ink)]"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilter("unread")}
              className={`px-2 py-1 rounded-[var(--radius-sm)] transition-colors cursor-pointer text-xs flex items-center gap-1 ${
                filter === "unread"
                  ? "bg-[var(--paper-subtle)] text-[var(--ink)] font-semibold"
                  : "text-[var(--ink-secondary)] hover:text-[var(--ink)]"
              }`}
            >
              <span>Unread</span>
              {unread > 0 && (
                <span className="px-1 rounded-full bg-[var(--ink-blue)] text-white text-[9px] font-mono">
                  {unread}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setFilter("attention")}
              className={`px-2 py-1 rounded-[var(--radius-sm)] transition-colors cursor-pointer text-xs ${
                filter === "attention"
                  ? "bg-[var(--paper-subtle)] text-[var(--ink)] font-semibold"
                  : "text-[var(--ink-secondary)] hover:text-[var(--ink)]"
              }`}
            >
              Needs attention
            </button>
          </div>

          {unread > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                markAllRead().catch((reason) => setError(reason.message))
              }
              className="text-[var(--ink-blue)] hover:text-[var(--ink-blue-hover)] flex-shrink-0"
            >
              <Check size={12} />
              <span>Mark all read</span>
            </Button>
          )}
        </div>

        {/* Notifications Scroll List */}
        <main className="flex-1 overflow-y-auto p-3 space-y-2 min-w-0">
          {error && (
            <div className="p-2.5 rounded bg-[var(--danger-bg)] text-xs text-[var(--danger)] break-words">
              {error}
            </div>
          )}

          {visible.map((item) => (
            <div
              key={item.id}
              className={`p-3 rounded-[var(--radius-sm)] border transition-all text-xs flex items-start gap-2.5 group min-w-0 ${
                item.read_at
                  ? "bg-[var(--surface)] border-[var(--hairline)] opacity-80"
                  : "bg-[var(--paper)] border-[var(--hairline-strong)] shadow-[var(--shadow-subtle)]"
              }`}
            >
              <div className="mt-0.5 flex-shrink-0">
                <NotificationIcon severity={item.severity} />
              </div>

              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() =>
                  markRead(item).catch((reason) => setError(reason.message))
                }
              >
                <div className="flex items-center justify-between gap-1 min-w-0">
                  <strong className="font-serif font-bold text-[var(--ink)] truncate">
                    {item.title}
                  </strong>
                  {!item.read_at && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--ink-blue)] flex-shrink-0" />
                  )}
                </div>
                <p className="text-[11px] text-[var(--ink-secondary)] font-sans mt-0.5 break-words">
                  {item.message}
                </p>
                <div className="flex items-center gap-1 mt-1 text-[10px] font-mono text-[var(--ink-muted)]">
                  <Clock3 size={10} />
                  <span>{new Date(item.created_at).toLocaleString()}</span>
                </div>
              </div>

              <Button
                variant="ghost"
                size="xs"
                className="opacity-0 group-hover:opacity-100 text-[var(--ink-muted)] hover:text-[var(--danger)] h-6 w-6 p-0 flex-shrink-0 transition-opacity"
                aria-label={`Delete ${item.title}`}
                onClick={() =>
                  remove(item).catch((reason) => setError(reason.message))
                }
              >
                <Trash2 size={12} />
              </Button>
            </div>
          ))}

          {visible.length === 0 && (
            <div className="p-8 text-center text-xs text-[var(--ink-muted)] space-y-1.5">
              <Bell
                size={24}
                className="mx-auto text-[var(--ink-faint)] opacity-60"
              />
              <p className="font-serif text-sm font-semibold text-[var(--ink)]">
                {filter === "unread"
                  ? "No unread notifications"
                  : filter === "attention"
                    ? "Nothing needs attention"
                    : "No notifications yet"}
              </p>
              <p className="text-[11px] max-w-xs mx-auto">
                Processing updates, completed exports, reviews, and team
                activity will appear here.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default NotificationCenter;
