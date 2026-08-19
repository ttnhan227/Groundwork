export type AppLanguage = "en" | "vi" | "es" | "ja" | "de" | "fr" | "zh" | "ko" | "pt";

export type UserPreferences = {
  language: AppLanguage;
  compact_sidebar: boolean;
  reduced_motion: boolean;
  default_export_format: "pdf" | "docx" | "markdown";
  document_language: string;
  default_tone: "professional" | "concise" | "technical" | "academic" | "friendly";
  citation_style: "inline" | "footnote" | "apa" | "mla" | "chicago";
  page_size: "a4" | "letter";
  theme: "light" | "dark" | "system";
  interface_size: "compact" | "comfortable" | "large";
  high_contrast: boolean;
  notify_processing_completed: boolean;
  notify_processing_failed: boolean;
  notify_comments: boolean;
  notify_reviews: boolean;
  retain_activity_history: boolean;
  retention_days: number;
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  language: "en",
  compact_sidebar: false,
  reduced_motion: false,
  default_export_format: "pdf",
  document_language: "English",
  default_tone: "professional",
  citation_style: "inline",
  page_size: "a4",
  theme: "light",
  interface_size: "comfortable",
  high_contrast: false,
  notify_processing_completed: true,
  notify_processing_failed: true,
  notify_comments: true,
  notify_reviews: true,
  retain_activity_history: true,
  retention_days: 90,
};

export const PREFERENCES_STORAGE_KEY = "groundwork-preferences";
export const PREFERENCES_CHANGED_EVENT = "groundwork-preferences-changed";

export function storedPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    return { ...DEFAULT_PREFERENCES, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function applyPreferences(preferences: UserPreferences) {
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  const root = document.documentElement;
  root.lang = preferences.language || "en";
  root.toggleAttribute("data-reduced-motion", preferences.reduced_motion);
  root.toggleAttribute("data-high-contrast", preferences.high_contrast);
  root.dataset.theme = preferences.theme;
  root.dataset.interfaceSize = preferences.interface_size;
  window.dispatchEvent(new CustomEvent<UserPreferences>(PREFERENCES_CHANGED_EVENT, { detail: preferences }));
}
