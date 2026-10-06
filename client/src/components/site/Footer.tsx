import { BrandMark } from "../common/BrandMark";

export function Footer({ navigate }: { navigate: (path: string) => void }) {
  return (
    <footer className="bg-[var(--surface)] border-t border-[var(--hairline)]">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex flex-col sm:flex-row gap-8 justify-between">
          <div className="max-w-sm">
            <p className="flex gap-3 items-center font-semibold text-lg mb-4">
              <BrandMark size={23} />
              Groundwork
            </p>
            <p className="text-[var(--ink-secondary)] leading-relaxed">
              Find your files, keep your notes, and pick up where you left off.
            </p>
          </div>
          <nav
            aria-label="Footer navigation"
            className="flex flex-col gap-3 text-sm text-[var(--ink-secondary)]"
          >
            <button
              className="text-left hover:text-[var(--ink-blue)]"
              onClick={() => navigate("/download")}
            >
              Download for Windows
            </button>
            <button
              className="text-left hover:text-[var(--ink-blue)]"
              onClick={() => navigate("/docs")}
            >
              Getting started
            </button>
            <button
              className="text-left hover:text-[var(--ink-blue)]"
              onClick={() => navigate("/privacy")}
            >
              Privacy
            </button>
            <a
              href="https://github.com/ttnhan227/Groundwork"
              className="hover:text-[var(--ink-blue)]"
            >
              Source code and developer setup
            </a>
          </nav>
        </div>
        <p className="text-sm text-[var(--ink-muted)] mt-10 pt-6 border-t border-[var(--hairline)]">
          © {new Date().getFullYear()} Groundwork · Open source under MIT
        </p>
      </div>
    </footer>
  );
}
