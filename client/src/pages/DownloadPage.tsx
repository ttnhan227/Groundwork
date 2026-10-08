import React, { useEffect, useState } from "react";
import { Download, Monitor, ShieldCheck } from "lucide-react";
import {
  fetchWindowsRelease,
  releasesUrl,
  type WindowsRelease,
} from "../services/releases";

export const DownloadPage: React.FC = () => {
  const [release, setRelease] = useState<WindowsRelease | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ready" | "missing" | "error"
  >("loading");
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    fetchWindowsRelease(controller.signal)
      .then((value) => {
        if (!cancelled) {
          setRelease(value);
          setStatus(value ? "ready" : "missing");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);
  return (
    <div className="bg-[var(--paper)] text-[var(--ink)] min-h-screen py-16 px-4">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="space-y-3 text-center">
          <Monitor className="w-8 h-8 mx-auto text-[var(--ink-blue)]" />
          <p className="text-xs font-mono uppercase tracking-widest text-[var(--ink-blue)]">
            Groundwork for Windows
          </p>
          <h1 className="text-4xl font-serif font-bold">Download Groundwork</h1>
          <p className="text-[var(--ink-secondary)]">
            Find your files, keep your notes, and return to your work.
          </p>
          <p className="text-sm text-[var(--ink-muted)]">
            For Windows 10 or 11 (64-bit). No separate tools or database to
            install.
          </p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--hairline)] rounded-lg p-8 space-y-5">
          <h2 className="text-xl font-serif font-bold">
            Windows desktop installer
          </h2>
          <p className="text-sm text-[var(--ink-secondary)]">
            {status === "loading"
              ? "Checking the latest version…"
              : release
                ? `${release.preview ? "Preview" : "Latest release"}: ${release.version} · ${(release.bytes / 1048576).toFixed(1)} MB`
                : status === "error"
                  ? "Unable to check the latest version right now. You can check the releases page directly."
                  : "A Windows installer has not been published yet. It will appear here automatically after a release passes its checks."}
          </p>
          {release?.preview && (
            <p className="text-sm text-[var(--ink-secondary)]">
              Groundwork is still in development. This preview is available to
              try; the finished 1.0 release is not ready yet.
            </p>
          )}
          <p className="text-sm text-[var(--ink-secondary)]">
            Includes the desktop workspace, search, Assistant, notes, and file
            organization. Local AI models are separate downloads. See release
            notes for changes and supported features.
          </p>
          {release ? (
            <a
              href={release.url}
              className="inline-flex items-center gap-2 rounded px-5 py-3 bg-[var(--control-room)] text-white text-sm font-semibold"
            >
              <Download size={16} />
              Download installer
            </a>
          ) : (
            <button
              disabled
              className="rounded px-5 py-3 bg-[var(--paper-subtle)] text-[var(--ink-muted)] text-sm"
            >
              {status === "loading"
                ? "Checking releases…"
                : "Installer not available"}
            </button>
          )}
          <details className="text-sm text-[var(--ink-secondary)]">
            <summary className="cursor-pointer">
              Previous versions and file verification
            </summary>
            <div className="space-y-3 mt-3">
              {release?.checksum && (
                <p className="text-xs font-mono break-all">
                  SHA-256: {release.checksum}
                </p>
              )}
              <a
                href={releasesUrl}
                className="block text-sm text-[var(--ink-blue)] underline"
              >
                All releases and checksums
              </a>
            </div>
          </details>
        </div>
        <section
          className="bg-[var(--surface)] border border-[var(--hairline)] rounded-lg p-8 space-y-3"
          aria-labelledby="macos-heading"
        >
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="macos-heading" className="text-xl font-semibold">
              Groundwork for macOS
            </h2>
            <span className="text-xs font-medium rounded-full px-3 py-1 bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)]">
              In development
            </span>
          </div>
          <p className="text-[var(--ink-secondary)] leading-relaxed">
            A macOS release is in progress. No public installer or release date
            is available yet. Windows is the currently supported platform.
          </p>
        </section>
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">After downloading</h2>
          <ol className="list-decimal pl-5 space-y-3 text-[var(--ink-secondary)]">
            <li>Open the installer and follow the steps.</li>
            <li>
              Launch Groundwork. Sign in or choose{" "}
              <strong>Continue locally</strong>.
            </li>
            <li>
              Click <strong>Choose folder</strong> in the workspace toolbar.
              Your files stay on your computer.
            </li>
          </ol>
        </section>
        <div className="flex gap-3 text-sm text-[var(--ink-secondary)]">
          <ShieldCheck className="shrink-0 text-[var(--ink-blue)]" />
          <p>
            Indexing runs locally. Optional cloud AI receives selected questions
            and retrieved excerpts only when you choose that provider. Optional
            sync transfers notes and saved searches.
          </p>
        </div>
      </div>
    </div>
  );
};
export default DownloadPage;
