import { ShieldCheck } from "lucide-react";

export function PrivacyPage() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-16 space-y-9">
      <ShieldCheck size={34} className="text-[var(--ink-blue)]" />
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">
          Your files. Your choice.
        </h1>
        <p className="mt-5 text-lg text-[var(--ink-secondary)] leading-relaxed">
          Groundwork searches your selected folders on your computer. Signing in
          and using online AI are optional.
        </p>
      </div>
      {[
        [
          "Files and search stay local",
          "Your original files, code repositories, Git history, and search index stay on this device. Groundwork's account service doesn't receive them. You choose which folders the app can search.",
        ],
        [
          "An account is optional",
          "Email sign-in uses your email and a protected password hash. Google sign-in uses your Google account identity and verified email to create or connect your Groundwork account. It doesn't request access to your Google Drive or Gmail.",
        ],
        [
          "Sync includes your notes",
          "When you sign in and sync, the content of your notes, saved searches, and supported preferences is stored with your account. These may contain personal information you write into them. Workspace files and AI keys are excluded.",
        ],
        [
          "Online AI shares selected excerpts",
          "If you choose OpenAI or Google Gemini, your question and relevant file excerpts are sent to that provider when you ask. Its privacy policy and usage charges apply. The default passage-finding mode works offline. Ollama can provide local answers with a separately installed model.",
        ],
        [
          "Credentials stay on this device",
          "API keys and account credentials are kept in private app preferences protected by your Windows account. They aren't included in sync. Signing out stops account sync without deleting your local work.",
        ],
        [
          "No activity tracking",
          "Groundwork doesn't send analytics about which files you open, what you search for, or the projects you work on. Account services still process sign-in and sync requests to provide those features.",
        ],
      ].map(([title, text]) => (
        <section key={title}>
          <h2 className="text-xl font-semibold mb-3">{title}</h2>
          <p className="text-[var(--ink-secondary)] leading-relaxed">{text}</p>
        </section>
      ))}
      <section className="border-t border-[var(--hairline)] pt-7">
        <h2 className="text-xl font-semibold mb-3">Questions?</h2>
        <p className="text-[var(--ink-secondary)]">
          Contact{" "}
          <a
            href="mailto:ttnhan227@gmail.com"
            className="text-[var(--ink-blue)] underline"
          >
            ttnhan227@gmail.com
          </a>{" "}
          about Groundwork and your privacy.
        </p>
      </section>
    </article>
  );
}
