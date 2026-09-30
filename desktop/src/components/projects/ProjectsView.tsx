import React, { useEffect, useState } from "react";
import {
  FolderGit2,
  GitBranch,
  Terminal,
  ExternalLink,
  BookOpen,
  Sparkles,
  Layers,
  Clock,
  X,
} from "lucide-react";
import { api } from "../../services/api";
import type { Project, ProjectOverview } from "../../types/api";

interface ProjectsViewProps {
  onInvestigateProject?: (project: Project) => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({ onInvestigateProject }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOverview, setSelectedOverview] = useState<ProjectOverview | null>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const data = await api.listProjects();
      setProjects(data);
    } catch (err) {
      console.error("Failed to load projects:", err);
    } finally {
      setLoading(false);
    }
  };

  const openOverview = async (project: Project) => {
    try {
      const overview = await api.getProjectOverview(project.id);
      setSelectedOverview(overview);
    } catch (err) {
      console.error("Failed to get overview:", err);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 w-full font-sans">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-4">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)] mb-1">
            Workspace Discovery
          </p>
          <h1 className="text-xl font-serif font-bold text-[var(--ink)] tracking-tight flex items-center gap-2">
            <FolderGit2 className="w-5 h-5 text-[var(--ink-blue)]" />
            Detected Projects
          </h1>
          <p className="text-xs text-[var(--ink-secondary)] mt-1">
            Groundwork automatically discovers and analyzes repositories, frameworks, and entry points.
          </p>
        </div>
        <span className="text-xs font-mono text-[var(--ink-secondary)] bg-[var(--surface)] px-3 py-1.5 rounded border border-[var(--hairline)] font-bold">
          {projects.length} Projects Tracked
        </span>
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="py-20 text-center text-[var(--ink-muted)] text-sm">Scanning workspace for projects...</div>
      ) : projects.length === 0 ? (
        <div className="py-20 text-center text-[var(--ink-muted)] text-sm">
          No projects discovered yet. Add a workspace directory in Settings to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((proj) => (
            <div
              key={proj.id}
              className="bg-[var(--surface)] border border-[var(--hairline)] rounded p-4 hover:border-[var(--ink-blue)] transition-all flex flex-col justify-between group shadow-xs"
            >
              <div>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-serif font-bold text-base text-[var(--ink)] group-hover:text-[var(--ink-blue)] transition-colors">
                      {proj.name}
                    </h3>
                    <p className="text-[11px] font-mono text-[var(--ink-muted)] truncate max-w-[220px]">
                      {proj.path}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] text-[var(--ink-blue)]">
                    {proj.detected_type}
                  </span>
                </div>

                {/* Git status */}
                <div className="flex items-center gap-2 text-xs text-[var(--ink-secondary)] my-2">
                  <GitBranch className="w-3.5 h-3.5 text-[var(--ink-muted)] shrink-0" />
                  <span className="font-mono text-[11px] text-[var(--ink-secondary)]">
                    {proj.git_branch || "local repo"}
                  </span>
                </div>

                {/* Frameworks tags */}
                {proj.frameworks.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 my-2">
                    {proj.frameworks.map((fw) => (
                      <span
                        key={fw}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--paper-subtle)] text-[var(--ink-secondary)] border border-[var(--hairline)] font-mono"
                      >
                        {fw}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions Footer */}
              <div className="pt-3 border-t border-[var(--hairline)] flex items-center justify-between gap-2 text-xs mt-3">
                <button
                  onClick={() => openOverview(proj)}
                  className="flex items-center gap-1 text-[11px] text-white px-2.5 py-1 rounded bg-[var(--control-room)] hover:bg-[var(--control-room-hover)] transition-colors font-semibold"
                >
                  <BookOpen className="w-3 h-3" />
                  Overview
                </button>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => api.openFolder(proj.path)}
                    title="Open folder in Explorer"
                    className="p-1 text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--surface-hover)] border border-[var(--hairline)] rounded transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                  {onInvestigateProject && (
                    <button
                      onClick={() => onInvestigateProject(proj)}
                      className="flex items-center gap-1 text-[11px] text-[var(--ink-blue)] px-2.5 py-1 rounded bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] hover:bg-[var(--ink-blue-border)] transition-colors font-semibold"
                    >
                      <Sparkles className="w-3 h-3 text-[var(--ink-blue)]" />
                      Investigate
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Project Overview Modal */}
      {selectedOverview && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-6"
          onClick={() => setSelectedOverview(null)}
        >
          <div
            className="w-full max-w-3xl bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-lg shadow-[var(--shadow-modal)] p-6 max-h-[85vh] overflow-y-auto space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-[var(--hairline)] pb-3">
              <div>
                <h2 className="text-lg font-serif font-bold text-[var(--ink)] flex items-center gap-2">
                  <FolderGit2 className="w-5 h-5 text-[var(--ink-blue)]" />
                  {selectedOverview.name}
                </h2>
                <p className="text-xs font-mono text-[var(--ink-muted)]">{selectedOverview.path}</p>
              </div>
              <button
                onClick={() => setSelectedOverview(null)}
                className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Entry points & Frameworks */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[var(--paper)] border border-[var(--hairline)] rounded p-3">
                <span className="text-[11px] font-mono font-bold text-[var(--ink)] block mb-1.5 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-[var(--ink-blue)]" />
                  Likely Entry Points
                </span>
                {selectedOverview.entry_points.length > 0 ? (
                  <ul className="space-y-1 text-xs font-mono text-[var(--ink-secondary)]">
                    {selectedOverview.entry_points.map((ep) => (
                      <li key={ep} className="text-[var(--ink-blue)] font-bold">
                        • {ep}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--ink-muted)]">None detected automatically</p>
                )}
              </div>

              <div className="bg-[var(--paper)] border border-[var(--hairline)] rounded p-3">
                <span className="text-[11px] font-mono font-bold text-[var(--ink)] block mb-1.5 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[var(--ink-sepia)]" />
                  Key Dependencies ({selectedOverview.dependencies.length})
                </span>
                <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                  {selectedOverview.dependencies.slice(0, 15).map((dep) => (
                    <span
                      key={dep}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--paper-subtle)] text-[var(--ink-secondary)] border border-[var(--hairline)] font-mono"
                    >
                      {dep}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* README Preview */}
            {selectedOverview.readme_preview && (
              <div className="bg-[var(--paper)] border border-[var(--hairline)] rounded p-4">
                <span className="text-[11px] font-mono font-bold text-[var(--ink)] block mb-2 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-[var(--ink-blue)]" />
                  README Preview
                </span>
                <div className="bg-[var(--paper-subtle)] border border-[var(--hairline)] rounded p-3 text-xs font-mono text-[var(--ink)] whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                  {selectedOverview.readme_preview}
                </div>
              </div>
            )}

            {/* Recent Git Commits */}
            {selectedOverview.recent_commits.length > 0 && (
              <div className="bg-[var(--paper)] border border-[var(--hairline)] rounded p-4">
                <span className="text-[11px] font-mono font-bold text-[var(--ink)] block mb-2 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[var(--signal)]" />
                  Recent Git Activity
                </span>
                <div className="divide-y divide-[var(--hairline-subtle)] max-h-40 overflow-y-auto">
                  {selectedOverview.recent_commits.map((c) => (
                    <div key={c.hash} className="py-1.5 flex items-center justify-between text-xs">
                      <span className="text-[var(--ink)] truncate max-w-[450px]">{c.message}</span>
                      <span className="font-mono text-[10px] text-[var(--ink-muted)]">{c.hash}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
