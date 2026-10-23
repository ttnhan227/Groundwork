import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { api } from "../../services/api";
import { Button, Modal } from "../ui";

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

