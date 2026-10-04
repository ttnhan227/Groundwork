import { useEffect, useState } from "react";
import { Search, Cloud, HardDrive } from "lucide-react";
import { api } from "../../services/api";
import type { Project } from "../../types/api";
import { Button } from "../ui";

export function Header({
  selectedProjectId,
  onSelectProject,
  onOpenSearch,
}: {
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onOpenSearch: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const refresh = () => {
      api
        .getSystemStatus()
        .then(() => setReady(true))
        .catch(() => setReady(false));
      api
        .listProjects()
        .then(setProjects)
        .catch(() => {});
      api
        .getSyncStatus()
        .then((status) => setSignedIn(status.is_authenticated))
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);
  return (
    <header className="h-16 border-b border-[var(--hairline)] bg-[var(--surface)] px-6 flex items-center justify-between gap-4 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <Button variant="ghost" onClick={onOpenSearch}>
          <Search size={18} />
          Search files
        </Button>
        {!!projects.length && (
          <select
            aria-label="Search in project"
            value={selectedProjectId || ""}
            onChange={(event) => onSelectProject(event.target.value || null)}
            className="max-w-48 border border-[var(--hairline)] rounded-lg bg-[var(--surface)] px-3 py-2 text-sm"
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <span
        role="status"
        className="flex items-center gap-2 text-sm text-[var(--ink-muted)] whitespace-nowrap"
      >
        {signedIn ? <Cloud size={16} /> : <HardDrive size={16} />}{" "}
        {!ready
          ? "Opening Groundwork…"
          : signedIn
            ? "Account connected"
            : "Saved on this computer"}
      </span>
    </header>
  );
}
export default Header;
