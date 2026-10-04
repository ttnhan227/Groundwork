import React, { useEffect, useState } from "react";
import {
  Clock,
  GitCommit,
  FileCode,
  FilePlus,
  FileX,
  FileText,
  Search,
  Sparkles,
  Folder,
  ExternalLink,
  FolderOpen,
  Calendar,
  RefreshCw,
} from "lucide-react";
import { api } from "../../services/api";
import type { ActivityItem } from "../../types/api";
import { Button, Card, Badge, EmptyState } from "../ui";

interface ActivityTimelineViewProps {
  selectedProjectId: string | null;
}

export const ActivityTimelineView: React.FC<ActivityTimelineViewProps> = ({
  selectedProjectId,
}) => {
  const [days, setDays] = useState<number>(2);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(false);
  const [summaryData, setSummaryData] = useState<{
    period_days: number;
    concise_summary: string;
    active_projects: string[];
    modified_files: Array<{ filename: string; path: string; project: string; mtime: string }>;
    recent_commits: Array<{ hash: string; author: string; date: string; message: string; project: string }>;
    active_sessions: Array<{ title: string; status: string; project: string }>;
  } | null>(null);

  const fetchActivities = async () => {
    setLoading(true);
    try {
      const data = await api.listActivities(days, selectedProjectId || undefined);
      setActivities(data);
    } catch (err) {
      console.error("Failed to load activity items:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    setSummaryLoading(true);
    try {
      const data = await api.getActivitySummary(days);
      setSummaryData(data);
    } catch (err) {
      console.error("Failed to load activity summary:", err);
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities();
    fetchSummary();
  }, [days, selectedProjectId]);

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "git_commit":
        return <GitCommit className="w-4 h-4 text-[var(--ink-sepia)]" />;
      case "file_modified":
        return <FileCode className="w-4 h-4 text-[var(--ink-blue)]" />;
      case "file_created":
        return <FilePlus className="w-4 h-4 text-[var(--success)]" />;
      case "file_deleted":
        return <FileX className="w-4 h-4 text-[var(--danger)]" />;
      case "note_created":
        return <FileText className="w-4 h-4 text-[var(--warning)]" />;
      case "investigation_started":
        return <Sparkles className="w-4 h-4 text-[var(--ink-blue)]" />;
      case "search_executed":
        return <Search className="w-4 h-4 text-[var(--ink-blue)]" />;
      default:
        return <Clock className="w-4 h-4 text-[var(--ink-muted)]" />;
    }
  };

  const formatTimestamp = (ts: string) => {
    try {
      const date = new Date(ts);
      return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return ts;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--paper)] text-[var(--ink)] font-sans w-full">
      {/* Top Header & Filters */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-[var(--hairline)]">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)] mb-1">
            Work Memory
          </p>
          <h1 className="text-xl font-serif font-bold tracking-tight text-[var(--ink)] flex items-center gap-2">
            <Clock className="w-5 h-5 text-[var(--ink-blue)]" />
            Activity Timeline
          </h1>
          <p className="text-xs text-[var(--ink-secondary)] mt-1">
            Chronological log of workspace edits, Git commits, investigations, and search interactions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-[var(--surface)] p-1 rounded-[var(--radius-sm)] border border-[var(--hairline)] text-xs">
            <Calendar className="w-3.5 h-3.5 text-[var(--ink-muted)] ml-1" />
            {[1, 2, 7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2.5 py-1 rounded-[var(--radius-xs)] text-xs transition-all font-mono font-semibold cursor-pointer ${
                  days === d
                    ? "bg-[var(--control-room)] text-white shadow-[var(--shadow-subtle)]"
                    : "text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                {d === 1 ? "Today" : `${d}d`}
              </button>
            ))}
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              fetchActivities();
              fetchSummary();
            }}
            title="Refresh Timeline"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* AI Context Synthesis Card */}
      <Card className="mb-6 border-[var(--hairline-strong)]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-[var(--radius-xs)] border border-[var(--ink-blue-border)] bg-[var(--ink-blue-subtle)] flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-[var(--ink-blue)]" />
            </div>
            <div>
              <h2 className="text-sm font-serif font-bold text-[var(--ink)]">What was I working on?</h2>
              <span className="text-[11px] text-[var(--ink-muted)]">
                Local synthesis of active files, commits, and sessions over {days} {days === 1 ? "day" : "days"}
              </span>
            </div>
          </div>
          {summaryLoading && (
            <Badge variant="human" className="font-mono">
              <RefreshCw className="w-3 h-3 animate-spin mr-1" /> Synthesizing...
            </Badge>
          )}
        </div>

        {summaryData ? (
          <div className="space-y-4">
            <p className="text-xs text-[var(--ink)] leading-relaxed font-sans bg-[var(--paper)] p-3.5 rounded-[var(--radius-sm)] border border-[var(--hairline)]">
              {summaryData.concise_summary}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              {/* Active Projects */}
              <div className="bg-[var(--paper-subtle)] p-3 rounded-[var(--radius-sm)] border border-[var(--hairline)]">
                <span className="text-[11px] font-mono font-bold text-[var(--ink)] flex items-center gap-1.5 mb-2">
                  <Folder className="w-3.5 h-3.5 text-[var(--ink-blue)]" />
                  Active Projects ({summaryData.active_projects.length})
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {summaryData.active_projects.length === 0 ? (
                    <span className="text-[11px] text-[var(--ink-muted)]">None detected</span>
                  ) : (
                    summaryData.active_projects.map((proj) => (
                      <Badge key={proj} variant="human" className="font-mono font-bold">
                        {proj}
                      </Badge>
                    ))
                  )}
                </div>
              </div>

              {/* Modified Files */}
              <div className="bg-[var(--paper-subtle)] p-3 rounded-[var(--radius-sm)] border border-[var(--hairline)]">
                <span className="text-[11px] font-mono font-bold text-[var(--ink)] flex items-center gap-1.5 mb-2">
                  <FileCode className="w-3.5 h-3.5 text-[var(--ink-blue)]" />
                  Modified Files ({summaryData.modified_files.length})
                </span>
                <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                  {summaryData.modified_files.length === 0 ? (
                    <span className="text-[11px] text-[var(--ink-muted)]">None</span>
                  ) : (
                    summaryData.modified_files.slice(0, 5).map((f) => (
                      <div
                        key={f.path}
                        onClick={() => api.openFile(f.path)}
                        className="flex items-center justify-between text-[11px] text-[var(--ink-secondary)] hover:text-[var(--ink-blue)] cursor-pointer truncate py-0.5 group font-mono"
                      >
                        <span className="truncate">{f.filename}</span>
                        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ml-1 shrink-0" />
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Recent Commits */}
              <div className="bg-[var(--paper-subtle)] p-3 rounded-[var(--radius-sm)] border border-[var(--hairline)]">
                <span className="text-[11px] font-mono font-bold text-[var(--ink)] flex items-center gap-1.5 mb-2">
                  <GitCommit className="w-3.5 h-3.5 text-[var(--ink-sepia)]" />
                  Recent Commits ({summaryData.recent_commits.length})
                </span>
                <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                  {summaryData.recent_commits.length === 0 ? (
                    <span className="text-[11px] text-[var(--ink-muted)]">None</span>
                  ) : (
                    summaryData.recent_commits.slice(0, 4).map((c) => (
                      <div key={c.hash} className="text-[10px] text-[var(--ink-secondary)] truncate py-0.5">
                        <span className="font-mono text-[var(--ink-sepia)] font-bold mr-1">
                          {c.hash.substring(0, 7)}
                        </span>
                        {c.message}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--ink-muted)]">No activity recorded yet for this period.</p>
        )}
      </Card>

      {/* Chronological Timeline List */}
      <div className="space-y-3">
        <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--ink-muted)] mb-2">
          Events Log ({activities.length})
        </h2>

        {loading ? (
          <EmptyState
            icon={<RefreshCw className="w-6 h-6 animate-spin text-[var(--ink-blue)]" />}
            title="Loading activity events..."
            compact
          />
        ) : activities.length === 0 ? (
          <EmptyState
            icon={<Clock size={28} />}
            title="No events recorded for this timeframe"
            description="As you edit files, run git commands, and search projects, events appear here."
            compact
          />
        ) : (
          <div className="relative pl-6 space-y-3 before:content-[''] before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-[var(--hairline-strong)]">
            {activities.map((item) => {
              const filePath = item.details?.path || item.details?.file_path;
              return (
                <div
                  key={item.id}
                  className="relative group bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--hairline)] hover:border-[var(--ink-blue)] rounded-[var(--radius-sm)] p-3 transition-all text-xs shadow-[var(--shadow-subtle)]"
                >
                  {/* Timeline Node Point */}
                  <div className="absolute -left-[27px] top-3.5 w-4 h-4 rounded-full bg-[var(--paper)] border-2 border-[var(--ink-blue)] flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--ink-blue)]" />
                  </div>

                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 shrink-0">
                        {getActivityIcon(item.activity_type)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[var(--ink)]">
                            {item.summary}
                          </span>
                          {item.project_name && (
                            <Badge variant="neutral">
                              {item.project_name}
                            </Badge>
                          )}
                        </div>

                        {filePath && (
                          <p className="text-[11px] text-[var(--ink-muted)] font-mono mt-0.5 truncate max-w-xl">
                            {filePath}
                          </p>
                        )}

                        {item.details?.message && (
                          <p className="text-[11px] text-[var(--ink-secondary)] mt-1 italic font-serif">
                            "{item.details.message}"
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-[var(--ink-muted)] font-mono">
                        {formatTimestamp(item.timestamp)}
                      </span>
                      {filePath && (
                        <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => api.openFile(filePath)}
                            title="Open File"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => api.revealFile(filePath)}
                            title="Reveal in Explorer"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
export default ActivityTimelineView;
