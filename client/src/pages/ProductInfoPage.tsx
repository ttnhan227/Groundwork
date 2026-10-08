import { ArrowRight, ExternalLink } from "lucide-react";

const repository = "https://github.com/ttnhan227/Groundwork";
export function ProductInfoPage({
  page,
  navigate,
}: {
  page: string;
  navigate: (path: string) => void;
}) {
  const titles: Record<string, string> = {
    resources: "Resources",
    about: "About Groundwork",
    contributors: "Contributors",
    contact: "Contact",
  };
  const intros: Record<string, string> = {
    resources:
      "Guides, release information, and source code to help you get more from Groundwork.",
    about:
      "A desktop workspace built around your local files, with search and AI tools close at hand.",
    contributors:
      "Groundwork is an independent, open-source project created by Tran Trong Nhan.",
    contact:
      "Report a problem, suggest an improvement, or get in touch with the developer.",
  };
  return (
    <div className="max-w-5xl mx-auto px-6 py-12 sm:py-16">
      <p className="text-[var(--ink-blue)] font-medium mb-3">Groundwork</p>
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
        {titles[page]}
      </h1>
      <p className="max-w-3xl text-lg text-[var(--ink-secondary)] leading-relaxed mt-5">
        {intros[page]}
      </p>
      {page === "resources" && (
        <div className="grid sm:grid-cols-2 gap-5 mt-10">
          {[
            {
              title: "Getting started",
              text: "Installation, adding locations, and your first search.",
              path: "/docs",
            },
            {
              title: "Release notes",
              text: "Published releases and changes in the Windows app.",
              path: "/changelog",
            },
            {
              title: "Downloads & requirements",
              text: "Latest Windows installer, verification details, and platform availability.",
              path: "/download",
            },
            {
              title: "Privacy",
              text: "How local data, optional sync, and AI providers are handled.",
              path: "/privacy",
            },
          ].map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="text-left border border-[var(--hairline)] rounded-xl bg-[var(--surface)] p-6 hover:border-[var(--ink-blue)]"
            >
              <h2 className="font-semibold text-lg flex justify-between items-center gap-3">
                {item.title}
                <ArrowRight size={18} />
              </h2>
              <p className="mt-3 text-[var(--ink-secondary)] leading-relaxed">
                {item.text}
              </p>
            </button>
          ))}
          <article className="sm:col-span-2 border-t border-[var(--hairline)] pt-6 mt-3">
            <h2 className="text-xl font-semibold">Developer resources</h2>
            <p className="mt-3 text-[var(--ink-secondary)]">
              Build instructions, development setup, and issue tracking are
              available in the repository.
            </p>
            <a
              className="inline-flex items-center gap-2 mt-4 text-[var(--ink-blue)] underline underline-offset-4"
              href={repository}
              target="_blank"
              rel="noreferrer"
            >
              GitHub repository
              <ExternalLink size={15} />
            </a>
          </article>
        </div>
      )}
      {page === "about" && (
        <div className="max-w-3xl mt-10 space-y-9">
          <section>
            <h2 className="text-xl font-semibold">Why Groundwork exists</h2>
            <p className="mt-3 text-[var(--ink-secondary)] leading-relaxed">
              Finding a file, understanding its contents, and deciding what to
              do next often takes several tools. Groundwork brings the folder
              tree, live search, storage details, notes, and Assistant into one
              desktop workspace.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold">Local by default</h2>
            <p className="mt-3 text-[var(--ink-secondary)] leading-relaxed">
              Your file index stays on your computer. Browsing, search, and
              local notes work without an account. You can choose a local AI
              model or an online provider, and enable account sync for notes and
              saved searches.
            </p>
          </section>
          <section className="border border-[var(--hairline)] bg-[var(--surface)] rounded-xl p-6">
            <h2 className="text-xl font-semibold">Platform roadmap</h2>
            <dl className="mt-4 space-y-4">
              <div>
                <dt className="font-semibold">Windows · Available</dt>
                <dd className="mt-1 text-[var(--ink-secondary)]">
                  Download the current release for Windows 10 or 11, 64-bit.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">macOS · In development</dt>
                <dd className="mt-1 text-[var(--ink-secondary)]">
                  A macOS version is in progress. There is no public installer
                  or confirmed release date yet. Platform-specific functionality
                  will be validated before release.
                </dd>
              </div>
            </dl>
          </section>
          <section>
            <h2 className="text-xl font-semibold">Open source</h2>
            <p className="mt-3 text-[var(--ink-secondary)] leading-relaxed">
              Groundwork is distributed under the MIT license. You can inspect
              the code, report issues, and contribute improvements.
            </p>
            <a
              href={repository}
              className="inline-block mt-3 text-[var(--ink-blue)] underline underline-offset-4"
            >
              View the source code
            </a>
          </section>
        </div>
      )}
      {page === "contributors" && (
        <div className="max-w-3xl mt-10 space-y-9">
          <section className="border border-[var(--hairline)] rounded-xl bg-[var(--surface)] p-6">
            <h2 className="text-xl font-semibold">Tran Trong Nhan</h2>
            <p className="mt-2 text-[var(--ink-secondary)]">
              Creator and maintainer
            </p>
            <a
              href="https://github.com/ttnhan227"
              className="inline-block mt-4 text-[var(--ink-blue)] underline underline-offset-4"
            >
              GitHub profile
            </a>
          </section>
          <section>
            <h2 className="text-xl font-semibold">Help improve Groundwork</h2>
            <p className="mt-3 text-[var(--ink-secondary)] leading-relaxed">
              Bug reports, documentation improvements, and code contributions
              are welcome. Check existing issues before starting work, and use a
              pull request to propose changes.
            </p>
            <a
              href={`${repository}/graphs/contributors`}
              className="inline-block mt-4 text-[var(--ink-blue)] underline underline-offset-4"
            >
              View repository contributors
            </a>
          </section>
        </div>
      )}
      {page === "contact" && (
        <div className="grid sm:grid-cols-2 gap-6 mt-10">
          <section className="border border-[var(--hairline)] rounded-xl bg-[var(--surface)] p-6">
            <h2 className="text-xl font-semibold">Bugs & feature requests</h2>
            <p className="mt-3 text-[var(--ink-secondary)] leading-relaxed">
              Include your app version, Windows version, steps to reproduce, and
              what you expected to happen. Remove private file contents and
              credentials from screenshots or logs.
            </p>
            <a
              href={`${repository}/issues`}
              className="inline-block mt-5 text-[var(--ink-blue)] underline underline-offset-4"
            >
              Open GitHub issues
            </a>
          </section>
          <section className="border border-[var(--hairline)] rounded-xl bg-[var(--surface)] p-6">
            <h2 className="text-xl font-semibold">Email the developer</h2>
            <p className="mt-3 text-[var(--ink-secondary)] leading-relaxed">
              For questions or privacy-related requests, contact Tran Trong
              Nhan.
            </p>
            <a
              href="mailto:ttnhan227@gmail.com"
              className="inline-block mt-5 text-[var(--ink-blue)] underline underline-offset-4 break-all"
            >
              ttnhan227@gmail.com
            </a>
            <p className="mt-4 text-sm text-[var(--ink-muted)]">
              Groundwork is independently maintained; response times may vary.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
