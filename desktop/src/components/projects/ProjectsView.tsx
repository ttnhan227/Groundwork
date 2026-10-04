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
  FolderOpen,
} from "lucide-react";
import { api } from "../../services/api";
import type { Project, ProjectOverview } from "../../types/api";
import { Button, Card, Badge, Modal, EmptyState } from "../ui";

interface ProjectsViewProps {
  onInvestigateProject?: (project: Project) => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({ onInvestigateProject }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOverview, setSelectedOverview] = useState<ProjectOverview | null>(null);
  const [fileHistory, setFileHistory] = useState<{path: string; diff: string; commits: Array<{hash: string; message: string}>} | null>(null);

  useEffect(() => {
    loadProjects();
    const timer = setInterval(() => { api.listProjects().then((data) => {setProjects(data); setError(null);}).catch((failure) => setError(String(failure))); }, 5000);
    return () => clearInterval(timer);
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const data = await api.listProjects();
      setProjects(data);
      setError(null);
    } catch (err) {
      console.error("Failed to load projects:", err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const openOverview = async (project: Project) => {
    try {
      const overview = await api.getProjectOverview(project.id);
      setSelectedOverview(overview);
      setFileHistory(null);
    } catch (err) {
      console.error("Failed to get overview:", err);
      setError(String(err));
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 w-full font-sans">
      {error && <p role="alert" className="text-sm text-[var(--danger)]">Projects unavailable: {error}</p>}
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
        <Badge variant="neutral" className="font-mono text-xs px-3 py-1 font-bold">
          {projects.length} Projects Tracked
        </Badge>
      </div>

      {/* Projects Grid */}
      {loading ? (
        <EmptyState
          icon={<FolderGit2 size={32} className="animate-pulse" />}
          title="Scanning workspace..."
          description="Locating git repositories, configuration manifests, and code trees."
        />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={36} />}
          title="No projects discovered yet"
          description="Add a workspace directory in Settings to index local repositories and code."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((proj) => (
            <Card
              key={proj.id}
              className="flex flex-col justify-between group hover:border-[var(--ink-blue)]"
            >
              <div>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-serif font-bold text-base text-[var(--ink)] group-hover:text-[var(--ink-blue)] transition-colors">
                      {proj.name}
                    </h3>
                    <p className="text-[11px] font-mono text-[var(--ink-muted)] truncate max-w-[210px]">
                      {proj.path}
                    </p>
                  </div>
                  <Badge variant="human" className="font-mono">
                    {proj.detected_type}
                  </Badge>
                </div>

                {/* Git branch status */}
                <div className="flex items-center gap-2 text-xs text-[var(--ink-secondary)] my-2">
                  <GitBranch className="w-3.5 h-3.5 text-[var(--ink-muted)] shrink-0" />
                  <span className="font-mono text-[11px] text-[var(--ink-secondary)]">
                    {proj.git_branch || "No Git branch detected"}
                  </span>
                </div>

                {/* Frameworks tags */}
                {proj.frameworks.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 my-2">
                    {proj.frameworks.map((fw) => (
                      <Badge key={fw} variant="neutral">
                        {fw}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions Footer */}
              <div className="pt-3 border-t border-[var(--hairline)] flex items-center justify-between gap-2 text-xs mt-3">
                <Button
                  variant="primary"
                  size="xs"
                  onClick={() => openOverview(proj)}
                >
                  <BookOpen className="w-3 h-3" />
                  Overview
                </Button>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => api.openFolder(proj.path)}
                    title="Open folder in Explorer"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </Button>
                  {onInvestigateProject && (
                    <Button
                      variant="agent"
                      size="xs"
                      onClick={() => onInvestigateProject(proj)}
                    >
                      <Sparkles className="w-3 h-3" />
                      Investigate
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Project Overview Modal */}
      {selectedOverview && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedOverview(null)}
          eyebrow="Repository Manifest"
          title={
            <div className="flex items-center gap-2">
              <FolderGit2 className="w-5 h-5 text-[var(--ink-blue)]" />
              <span>{selectedOverview.name}</span>
            </div>
          }
          maxWidth="2xl"
        >
          <div className="space-y-4">
            <p className="text-xs font-mono text-[var(--ink-muted)] -mt-2">
              {selectedOverview.path}
            </p>

            {/* Entry points & Frameworks */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[var(--paper)] border border-[var(--hairline)] rounded-[var(--radius-sm)] p-3">
                <span className="text-[11px] font-mono font-bold text-[var(--ink)] block mb-1.5 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-[var(--ink-blue)]" />
                  Detected Entry Points
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

              <div className="bg-[var(--paper)] border border-[var(--hairline)] rounded-[var(--radius-sm)] p-3">
                <span className="text-[11px] font-mono font-bold text-[var(--ink)] block mb-1.5 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[var(--ink-sepia)]" />
                  Key Dependencies ({selectedOverview.dependencies.length})
                </span>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {selectedOverview.dependencies.slice(0, 15).map((dep) => (
                    <Badge key={dep} variant="neutral">
                      {dep}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {/* README Preview */}
            {selectedOverview.readme_preview && (
              <div className="bg-[var(--paper)] border border-[var(--hairline)] rounded-[var(--radius-sm)] p-3.5">
                <span className="text-[11px] font-mono font-bold text-[var(--ink)] block mb-2 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-[var(--ink-blue)]" />
                  README Preview
                </span>
                <div className="bg-[var(--paper-subtle)] border border-[var(--hairline)] rounded-[var(--radius-xs)] p-3 text-xs font-mono text-[var(--ink)] whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                  {selectedOverview.readme_preview}
                </div>
              </div>
            )}

            {/* Recent Git Commits */}
            {selectedOverview.key_files.length > 0 && <section className="border-t border-[var(--hairline)] pt-3"><h3 className="font-serif font-bold text-sm mb-2">Project files</h3><div className="space-y-1">{selectedOverview.key_files.map((file) => <div key={file.name} className="flex justify-between text-xs font-mono"><span>{file.name}{file.is_dir ? "/" : ""}</span>{!file.is_dir && <div className="flex gap-2"><button onClick={() => api.openFile(`${selectedOverview.path}/${file.name}`).catch((error) => alert(String(error)))}>Open</button>{selectedOverview.working_tree?.branch && <button onClick={() => api.getFileHistory(selectedOverview.id, file.name).then(setFileHistory).catch((error) => alert(String(error)))}>History</button>}</div>}</div>)}</div></section>}
            {selectedOverview.working_tree?.branch && <section className="border-t border-[var(--hairline)] pt-3 space-y-2">
              <h3 className="font-serif font-bold text-sm">Working tree · {selectedOverview.working_tree.branch}</h3>
              {!selectedOverview.working_tree.changed_files?.length && <p className="text-xs text-[var(--ink-muted)]">No uncommitted changes.</p>}
              {selectedOverview.working_tree.changed_files?.map((file) => <button key={file.file} className="flex gap-3 text-xs font-mono w-full text-left hover:text-[var(--ink-blue)]" onClick={() => api.getFileHistory(selectedOverview.id, file.file).then(setFileHistory).catch((error) => alert(String(error)))}><span>{file.status}</span><span>{file.file}</span></button>)}
              {fileHistory && <div className="space-y-2"><p className="text-xs font-mono font-bold">{fileHistory.path}</p>{fileHistory.commits.map((commit) => <p key={commit.hash} className="text-xs">{commit.hash.slice(0,7)} · {commit.message}</p>)}<pre className="text-xs font-mono whitespace-pre-wrap max-h-60 overflow-auto">{fileHistory.diff || "No tracked changes against HEAD."}</pre></div>}
            </section>}
            {selectedOverview.recent_commits.length > 0 && (
              <div className="bg-[var(--paper)] border border-[var(--hairline)] rounded-[var(--radius-sm)] p-3.5">
                <span className="text-[11px] font-mono font-bold text-[var(--ink)] block mb-2 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[var(--signal)]" />
                  Recent Git Activity
                </span>
                <div className="divide-y divide-[var(--hairline-subtle)] max-h-40 overflow-y-auto">
                  {selectedOverview.recent_commits.map((c) => (
                    <div key={c.hash} className="py-1.5 flex items-center justify-between text-xs">
                      <span className="text-[var(--ink)] truncate max-w-[450px] font-sans">{c.message}</span>
                      <span className="font-mono text-[10px] text-[var(--ink-muted)] shrink-0 ml-2">{c.hash}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
export default ProjectsView;
