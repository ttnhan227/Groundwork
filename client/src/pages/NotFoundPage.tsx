import { ArrowLeft } from "lucide-react";
import { AppLink } from "../components/common/AppLink";

export function NotFoundPage({
  navigate,
}: {
  navigate: (path: string) => void;
}) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 sm:py-24">
      <p className="text-[var(--ink-blue)] font-medium mb-3">404</p>
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
        Page not found
      </h1>
      <p className="text-lg text-[var(--ink-secondary)] leading-relaxed mt-4">
        The page you requested does not exist or may have been moved.
      </p>
      <div className="flex flex-wrap gap-4 mt-8">
        <AppLink
          to="/"
          navigate={navigate}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--ink-blue)] text-white px-5 py-2.5 font-medium"
        >
          <ArrowLeft size={16} />
          Back to home
        </AppLink>
        <AppLink
          to="/docs"
          navigate={navigate}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--hairline)] bg-[var(--surface)] px-5 py-2.5 font-medium"
        >
          Read documentation
        </AppLink>
      </div>
    </div>
  );
}
