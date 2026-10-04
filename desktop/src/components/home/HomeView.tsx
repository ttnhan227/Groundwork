import { useEffect, useState } from "react";
import { ArrowRight, FolderOpen, Search, FileText, Clock } from "lucide-react";
import { api } from "../../services/api";
import type { Workspace } from "../../types/api";
import { Button, Card } from "../ui";
import { AddFolderDialog } from "../folders/FoldersView";

export function HomeView({
  onNavigate,
  onSearch,
}: {
  onNavigate: (tab: string) => void;
  onSearch: () => void;
}) {
  const [folders, setFolders] = useState<Workspace[]>([]);
  const [adding, setAdding] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const load = () =>
    api
      .listWorkspaces()
      .then((data) => {
        setFolders(data);
        setLoaded(true);
        setError(false);
      })
      .catch(() => {
        setLoaded(true);
        setError(true);
      });
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="gw-page max-w-5xl">
      <div>
        <p className="text-sm font-medium text-[var(--ink-blue)] mb-2">
          Your place to pick up where you left off
        </p>
        <h1 className="gw-title text-3xl">Welcome home.</h1>
        <p className="gw-description">
          Find a file, capture a thought, or return to your work.
        </p>
      </div>
      {error ? (
        <Card>
          <p className="mb-3">
            Groundwork is having trouble opening your folders.
          </p>
          <Button onClick={load}>Try again</Button>
        </Card>
      ) : !loaded ? (
        <p role="status">Opening your folders…</p>
      ) : !folders.length ? (
        <Card className="flex flex-col sm:flex-row gap-6 items-start p-8">
          <span className="p-4 rounded-2xl bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)]">
            <FolderOpen size={36} />
          </span>
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold">
              Make your files easy to find
            </h2>
            <p className="max-w-xl text-[var(--ink-secondary)] leading-relaxed">
              Add a folder from your computer. Groundwork prepares it for search
              and keeps up with your changes. Your files stay right where they
              are.
            </p>
            <Button variant="primary" size="lg" onClick={() => setAdding(true)}>
              Add your first folder
              <ArrowRight size={17} />
            </Button>
          </div>
        </Card>
      ) : (
        <button
          onClick={onSearch}
          className="w-full p-5 flex gap-4 items-center rounded-xl border border-[var(--hairline)] bg-[var(--surface)] text-left hover:border-[var(--ink-blue)] shadow-[var(--shadow-subtle)]"
        >
          <Search size={24} className="text-[var(--ink-blue)]" />
          <span className="flex-1 text-lg text-[var(--ink-secondary)]">
            Find something in your files…
          </span>
          <kbd className="text-xs text-[var(--ink-muted)]">Ctrl + Space</kbd>
        </button>
      )}
      <div className="grid sm:grid-cols-3 gap-4">
        {[
          {
            title: "Find a file",
            description: "Search by name or a phrase you remember.",
            icon: Search,
            action: onSearch,
          },
          {
            title: "Write a note",
            description: "Keep ideas and reminders close to your work.",
            icon: FileText,
            action: () => onNavigate("notes"),
          },
          {
            title: "Pick up your work",
            description: "Return to questions and work you've saved.",
            icon: Clock,
            action: () => onNavigate("sessions"),
          },
        ].map((item) => (
          <button
            key={item.title}
            onClick={item.action}
            className="text-left p-6 rounded-xl border border-[var(--hairline)] bg-[var(--surface)] hover:border-[var(--ink-blue)] transition-colors"
          >
            <item.icon size={23} className="text-[var(--ink-blue)] mb-4" />
            <h2 className="font-semibold text-base mb-2">{item.title}</h2>
            <p className="text-sm text-[var(--ink-secondary)] leading-relaxed">
              {item.description}
            </p>
          </button>
        ))}
      </div>
      {!!folders.length && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your folders</h2>
            <Button variant="ghost" onClick={() => onNavigate("folders")}>
              Manage folders
              <ArrowRight size={15} />
            </Button>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {folders.map((folder) => (
              <button
                key={folder.id}
                className="flex gap-3 items-center p-4 text-left rounded-lg border border-[var(--hairline)] bg-[var(--surface)] hover:border-[var(--ink-blue)]"
                onClick={() =>
                  api.openFolder(folder.path).catch(() => setError(true))
                }
              >
                <FolderOpen size={20} className="text-[var(--ink-blue)]" />
                <span className="min-w-0">
                  <span className="font-medium block">{folder.name}</span>
                  <span className="block truncate text-sm text-[var(--ink-muted)]">
                    {folder.path}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {adding && (
        <AddFolderDialog
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
    </div>
  );
}
