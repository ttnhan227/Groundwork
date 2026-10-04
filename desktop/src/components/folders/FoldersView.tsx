import { useEffect, useState } from "react";
import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { api } from "../../services/api";
import type { Workspace } from "../../types/api";
import { Button, Card, Modal } from "../ui";

export function AddFolderDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal isOpen onClose={onClose} title="Add a folder" maxWidth="md">
      <form
        className="space-y-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!path.trim()) return;
          setBusy(true);
          setError("");
          try {
            await api.createWorkspace(
              name.trim() || path.trim().split(/[\\/]/).pop() || "My folder",
              path.trim(),
            );
            onAdded();
          } catch {
            setError(
              "Couldn't add that folder. Check that it exists and you have permission to open it.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-[var(--ink-secondary)]">
          Choose a folder you want to search. Groundwork keeps your files on
          your computer and follows changes automatically.
        </p>
        {error && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
        {isTauri() && (
          <Button
            size="lg"
            className="w-full"
            onClick={async () => {
              try {
                const selected = await api.pickWorkspaceFolder();
                if (selected) {
                  setPath(selected);
                  setName(selected.split(/[\\/]/).pop() || "My folder");
                }
              } catch {
                setError(
                  "Couldn't open the folder chooser. You can paste a folder location below.",
                );
              }
            }}
            type="button"
          >
            <FolderOpen size={18} />
            Choose folder
          </Button>
        )}
        {path && (
          <p className="rounded-lg bg-[var(--paper-subtle)] p-3 text-sm break-all">
            {path}
          </p>
        )}
        <details open={!isTauri()}>
          <summary className="text-sm text-[var(--ink-secondary)] cursor-pointer">
            Paste a folder location
          </summary>
          <input
            className="gw-input mt-3"
            aria-label="Folder location"
            placeholder="Folder location"
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
        </details>
        {path && (
          <label className="block text-sm font-medium">
            Folder name
            <input
              className="gw-input mt-1.5"
              aria-label="Folder name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!path.trim()}
            isLoading={busy}
          >
            Add folder
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function FoldersView() {
  const [folders, setFolders] = useState<Workspace[]>([]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const load = () =>
    api
      .listWorkspaces()
      .then(setFolders)
      .catch(() => setMessage("Couldn't load your folders. Please try again."))
      .finally(() => setLoaded(true));
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="gw-page max-w-4xl">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h1 className="gw-title">Your folders</h1>
          <p className="gw-description">
            Choose where Groundwork looks for your files.
          </p>
        </div>
        <Button variant="primary" size="lg" onClick={() => setAdding(true)}>
          <Plus size={18} />
          Add folder
        </Button>
      </div>
      {message && (
        <p role="status" className="gw-notice">
          {message}
        </p>
      )}
      {!loaded ? (
        <p role="status">Opening your folders…</p>
      ) : folders.length ? (
        <div className="space-y-3">
          {folders.map((folder) => (
            <Card key={folder.id} className="flex items-center gap-4">
              <FolderOpen
                className="text-[var(--ink-blue)] shrink-0"
                size={24}
              />
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold">{folder.name}</h2>
                <p className="text-sm text-[var(--ink-secondary)] break-all mt-1">
                  {folder.path}
                </p>
              </div>
              <Button
                variant="ghost"
                aria-label={`Remove ${folder.name}`}
                onClick={() => setRemoving(folder)}
              >
                <Trash2 size={18} />
              </Button>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="py-12 text-center space-y-4">
          <FolderOpen className="mx-auto text-[var(--ink-blue)]" size={40} />
          <h2 className="text-xl font-semibold">
            Start with a folder you use often
          </h2>
          <p className="text-[var(--ink-secondary)]">
            Add your documents or a project folder. You can add more later.
          </p>
          <Button variant="primary" size="lg" onClick={() => setAdding(true)}>
            Choose your first folder
          </Button>
        </Card>
      )}
      <p className="text-sm text-[var(--ink-secondary)]">
        Files are prepared for search in the background. Changes are picked up
        automatically while Groundwork is open.
      </p>
      {adding && (
        <AddFolderDialog
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            setMessage(
              "Folder added. Your files will appear in search as they are ready.",
            );
            void load();
          }}
        />
      )}
      {removing && (
        <Modal
          isOpen
          onClose={() => setRemoving(null)}
          title="Remove this folder?"
          maxWidth="sm"
        >
          <p className="text-[var(--ink-secondary)] mb-5">
            Groundwork will stop searching {removing.name}. The original folder
            and files won't be deleted.
          </p>
          <div className="flex justify-end gap-3">
            <Button onClick={() => setRemoving(null)}>Keep folder</Button>
            <Button
              variant="danger"
              isLoading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.deleteWorkspace(removing.id);
                  setRemoving(null);
                  await load();
                } catch {
                  setMessage("Couldn't remove the folder. Please try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove folder
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
