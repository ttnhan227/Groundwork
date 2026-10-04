import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import {
  fetchWindowsRelease,
  releasesUrl,
  type WindowsRelease,
} from "../services/releases";

export function ChangelogPage() {
  const [release, setRelease] = useState<WindowsRelease | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    fetchWindowsRelease(controller.signal)
      .then(setRelease)
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        setLoaded(true);
      });
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, []);
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 space-y-8">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">What's new</h1>
        <p className="text-lg text-[var(--ink-secondary)] mt-4">
          Get the latest version of Groundwork.
        </p>
      </div>
      <div className="p-8 rounded-xl border border-[var(--hairline)] bg-[var(--surface)] space-y-5">
        <h2 className="text-2xl font-semibold">
          {release
            ? `Groundwork ${release.version}${release.preview ? ' — Preview' : ''}`
            : loaded
              ? "Groundwork releases"
              : "Checking the latest version…"}
        </h2>
        <p className="text-[var(--ink-secondary)]">
          Release notes and previous versions are available on GitHub. To update
          the desktop app, download and run the latest installer. Your saved
          work stays on this computer.
        </p>
        {release && (
          <a className="site-primary" href={release.url}>
            <Download size={18} />
            Download latest version
          </a>
        )}
        <a
          href={releasesUrl}
          className="block text-[var(--ink-blue)] underline"
        >
          Read release notes
        </a>
      </div>
    </div>
  );
}
