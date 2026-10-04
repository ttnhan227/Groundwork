import { useEffect, useState } from "react";
import { Cloud, UserRound, ShieldCheck } from "lucide-react";
import { api } from "../../services/api";
import { isTauri } from "@tauri-apps/api/core";
import { Button, Card } from "../ui";

export function AccountView({
  onSignIn,
  onLinkGoogle,
  onChanged,
}: {
  onSignIn: () => void;
  onLinkGoogle: () => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<Awaited<
    ReturnType<typeof api.getSyncStatus>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const load = () =>
    api
      .getSyncStatus()
      .then((result) => {
        setStatus(result);
        setLoadFailed(false);
      })
      .catch(() => {
        setLoadFailed(true);
        setMessage(
          "Account details are unavailable right now. Your local work is still available.",
        );
      });
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="gw-page max-w-3xl">
      <div>
        <h1 className="gw-title">Account</h1>
        <p className="gw-description">
          Your notes and saved searches, wherever you work.
        </p>
      </div>
      {message && (
        <p role="status" className="gw-notice">
          {message}
        </p>
      )}
      <Card className="space-y-5">
        <UserRound size={28} className="text-[var(--ink-blue)]" />
        <h2 className="text-xl font-semibold">
          {!status
            ? loadFailed ? "Couldn't check your account" : "Checking your account…"
            : status.is_authenticated
              ? "You're signed in"
              : "You're using Groundwork locally"}
        </h2>
        <p className="text-[var(--ink-secondary)]">
          {status?.is_authenticated
            ? "Sync your notes and saved searches with your other computers."
            : "Everything you create is saved on this computer. Sign in whenever you'd like to sync notes and saved searches."}
        </p>
        {status?.is_authenticated ? (
          <>
            <p className="text-sm text-[var(--ink-secondary)]">
              {status.pending_items
                ? `${status.pending_items} changes waiting to sync`
                : "No local changes waiting to sync"}
            </p>
            <div className="flex gap-3 flex-wrap">
              <Button
                variant="primary"
                size="lg"
                isLoading={busy}
                onClick={async () => {
                  setBusy(true);
                  setMessage("");
                  try {
                    const result = await api.triggerSync();
                    setMessage(
                      result.status === "success"
                        ? "Your notes and saved searches are up to date."
                        : "Couldn't sync right now. Your changes are saved here; try again when you're connected.",
                    );
                    await load();
                  } catch {
                    setMessage(
                      "Couldn't sync right now. Your changes are saved on this computer.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Cloud size={17} />
                Sync now
              </Button>
              <Button
                size="lg"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.logoutCloud();
                    await load();
                    onChanged();
                    setMessage(
                      "Signed out. Your folders and local notes are still here.",
                    );
                  } catch {
                    setMessage("Couldn't sign out. Please try again.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Sign out
              </Button>
            </div>
          </>
        ) : (
          loadFailed ? <Button onClick={async () => { setMessage(""); setLoadFailed(false); await load(); }}>Try again</Button> : <Button
            variant="primary"
            size="lg"
            disabled={!status}
            onClick={onSignIn}
          >
            Sign in
          </Button>
        )}
        {status?.is_authenticated && isTauri() && (
          <details className="text-sm border-t border-[var(--hairline)] pt-4">
            <summary className="cursor-pointer text-[var(--ink-secondary)]">
              Sign-in options
            </summary>
            <div className="mt-4 space-y-3">
              <p>
                Already use email and password? Connect Google with the same
                email to sign in more easily.
              </p>
              <Button onClick={onLinkGoogle} disabled={busy}>
                Connect Google
              </Button>
            </div>
          </details>
        )}
      </Card>
      <div className="flex items-start gap-3 text-[var(--ink-secondary)]">
        <ShieldCheck size={22} className="shrink-0 text-[var(--success)]" />
        <p className="text-sm leading-relaxed">
          Sync includes the content of your notes and saved searches. Your
          workspace files, search index, and AI keys stay on this computer.
          Signing out doesn't delete your local work.
        </p>
      </div>
    </div>
  );
}
