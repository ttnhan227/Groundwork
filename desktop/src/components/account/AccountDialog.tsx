import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import { api } from "../../services/api";
import { Button, Modal } from "../ui";

export function AccountDialog({
  welcome = false,
  link = false,
  onClose,
  onConnected,
}: {
  welcome?: boolean;
  link?: boolean;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [register, setRegister] = useState(false);
  const [emailForm, setEmailForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [googlePending, setGooglePending] = useState(false);
  const session = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const id = session.current;
      session.current = null;
      if (id && id !== "starting")
        void api.cancelGoogleSignIn(id).catch(() => {});
    };
  }, []);
  const cancelGoogle = () => {
    const id = session.current;
    session.current = null;
    if (id && id !== "starting")
      void api.cancelGoogleSignIn(id).catch(() => {});
    setBusy(false);
    setGooglePending(false);
  };
  const google = async () => {
    setBusy(true);
    setError("");
    setGooglePending(true);
    session.current = "starting";
    try {
      const { session_id } = await api.startGoogleSignIn(link);
      if (session.current !== "starting") {
        await api.cancelGoogleSignIn(session_id);
        return;
      }
      session.current = session_id;
      const deadline = Date.now() + 300000;
      while (session.current === session_id && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (session.current !== session_id) return;
        const result = await api.pollGoogleSignIn(session_id);
        if (session.current !== session_id) return;
        if (result.status === "authenticated") {
          session.current = null;
          if (mounted.current) onConnected();
          return;
        }
      }
      if (session.current === session_id) {
        cancelGoogle();
        setError("Sign-in expired. Please try again.");
      }
    } catch (failure) {
      if (mounted.current && session.current) {
        cancelGoogle();
        setError(
          failure instanceof Error
            ? failure.message
            : "Couldn't sign in. Please try again.",
        );
      }
    } finally {
      if (mounted.current && !session.current) {
        setBusy(false);
        setGooglePending(false);
      }
    }
  };
  return (
    <Modal
      isOpen
      onClose={() => {
        if (!busy || googlePending) onClose();
      }}
      title={
        link
          ? "Connect your Google account"
          : welcome
            ? "Welcome to Groundwork"
            : register
              ? "Create your account"
              : "Sign in to Groundwork"
      }
      maxWidth="md"
    >
      <div className="space-y-5">
        <p className="text-base text-[var(--ink-secondary)] leading-relaxed">
          {link
            ? "Connect the Google account with the same email as your Groundwork account. You can then use Google to sign in next time."
            : welcome
              ? "Find your files, keep notes, and pick up where you left off. Start on this computer, or sign in to sync your notes and saved searches."
              : "Sync your notes and saved searches across your computers. Your folders and files stay on this device."}
        </p>
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
          >
            {error}
          </p>
        )}
        {googlePending ? (
          <div
            role="status"
            className="space-y-3 rounded-xl bg-[var(--paper-subtle)] p-4"
          >
            <p className="font-semibold">Finish signing in in your browser</p>
            <p className="text-sm text-[var(--ink-secondary)]">
              Choose your Google account. Groundwork will connect automatically
              when you return.
            </p>
            <Button onClick={cancelGoogle}>Cancel sign-in</Button>
          </div>
        ) : (
          <>
            {isTauri() && (
              <Button
                className="w-full"
                size="lg"
                disabled={busy}
                onClick={google}
              >
                <svg
                  aria-hidden="true"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                >
                  <path
                    fill="#4285F4"
                    d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.3 2.98-7.36Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M6.4 13.93a6 6 0 0 1 0-3.86V7.48H3.06a10 10 0 0 0 0 9.04l3.34-2.59Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.95c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.48l3.34 2.59C7.19 7.71 9.4 5.95 12 5.95Z"
                  />
                </svg>{" "}
                Sign in with Google
              </Button>
            )}
            {!link &&
              (!emailForm ? (
                <Button
                  className="w-full"
                  size="lg"
                  variant="primary"
                  disabled={busy}
                  onClick={() => setEmailForm(true)}
                >
                  <Mail size={18} /> Sign in with email
                </Button>
              ) : (
                <form
                  className="space-y-4"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    setBusy(true);
                    setError("");
                    try {
                      await api.loginCloud(email.trim(), password, register);
                      if (mounted.current) onConnected();
                    } catch (failure) {
                      if (mounted.current)
                        setError(
                          failure instanceof Error
                            ? failure.message
                            : "Couldn't sign in. Please try again.",
                        );
                    } finally {
                      if (mounted.current) setBusy(false);
                    }
                  }}
                >
                  <label className="block text-sm font-medium">
                    Email
                    <input
                      className="gw-input mt-1.5"
                      aria-label="Account email"
                      type="email"
                      autoComplete="username"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </label>
                  <label className="block text-sm font-medium">
                    Password
                    <input
                      className="gw-input mt-1.5"
                      aria-label="Account password"
                      type="password"
                      autoComplete={
                        register ? "new-password" : "current-password"
                      }
                      minLength={register ? 12 : 1}
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </label>
                  {register && (
                    <p className="text-sm text-[var(--ink-secondary)]">
                      Use at least 12 characters.
                    </p>
                  )}
                  <Button
                    className="w-full"
                    variant="primary"
                    size="lg"
                    type="submit"
                    isLoading={busy}
                  >
                    {register ? "Create account" : "Sign in"}
                    <ArrowRight size={16} />
                  </Button>
                  <button
                    type="button"
                    disabled={busy}
                    className="text-sm text-[var(--ink-blue)] underline"
                    onClick={() => {
                      setRegister(!register);
                      setError("");
                    }}
                  >
                    {register
                      ? "Already have an account? Sign in"
                      : "New here? Create an account"}
                  </button>
                </form>
              ))}
          </>
        )}
        <div className="border-t border-[var(--hairline)] pt-4 space-y-3">
          <Button
            size="lg"
            className="w-full"
            variant="ghost"
            disabled={busy && !googlePending}
            onClick={onClose}
          >
            {link
              ? "Cancel"
              : welcome
                ? "Continue locally"
                : "Continue without signing in"}
          </Button>
          {!link && (
            <p className="flex items-start gap-2 text-sm text-[var(--ink-secondary)]">
              <LockKeyhole className="shrink-0 mt-0.5" size={15} /> No account
              needed to search files or keep notes. You can sign in later from
              Account.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
