import { useCallback, useEffect, useState } from "react";
import {
  PREFERENCES_CHANGED_EVENT,
  applyPreferences,
  storedPreferences,
  type AppLanguage,
  type UserPreferences,
} from "../features/account/preferences";

export type Language = AppLanguage;

export const LANGUAGE_OPTIONS: Array<{
  code: Language;
  label: string;
  flag: string;
  nativeName: string;
}> = [
  { code: "en", label: "English", flag: "🇺🇸", nativeName: "English" },
  { code: "vi", label: "Vietnamese", flag: "🇻🇳", nativeName: "Tiếng Việt" },
  { code: "es", label: "Spanish", flag: "🇪🇸", nativeName: "Español" },
  { code: "ja", label: "Japanese", flag: "🇯🇵", nativeName: "日本語" },
  { code: "de", label: "German", flag: "🇩🇪", nativeName: "Deutsch" },
  { code: "fr", label: "French", flag: "🇫🇷", nativeName: "Français" },
  {
    code: "zh",
    label: "Chinese (Simplified)",
    flag: "🇨🇳",
    nativeName: "简体中文",
  },
  { code: "ko", label: "Korean", flag: "🇰🇷", nativeName: "한국어" },
  { code: "pt", label: "Portuguese", flag: "🇧🇷", nativeName: "Português" },
];

function getActiveLanguage(): Language {
  return (storedPreferences().language as Language) || "en";
}

export function useTranslation() {
  const [language, setLanguageState] = useState<Language>(getActiveLanguage);

  useEffect(() => {
    function handlePreferencesChange(event: Event) {
      const preferences = (event as CustomEvent<UserPreferences>).detail;
      setLanguageState(
        (preferences?.language as Language | undefined) || getActiveLanguage(),
      );
    }

    window.addEventListener(PREFERENCES_CHANGED_EVENT, handlePreferencesChange);
    return () =>
      window.removeEventListener(
        PREFERENCES_CHANGED_EVENT,
        handlePreferencesChange,
      );
  }, []);

  const setLanguage = useCallback((nextLanguage: Language) => {
    const updated: UserPreferences = {
      ...storedPreferences(),
      language: nextLanguage,
    };
    applyPreferences(updated);
    setLanguageState(nextLanguage);
  }, []);

  return {
    language,
    setLanguage,
    languageOptions: LANGUAGE_OPTIONS,
  };
}

/**
 * Legacy terminology compatibility dictionary.
 * Maps legacy RFP/bid response terms to clean document/notebook terminology.
 */
export const LEGACY_TERMINOLOGY_MAP = {
  "Bid responses": "Documents",
  "New Response": "New Document",
  "Search responses": "Search documents",
  "Turn a bid pack into a controlled response": "Turn research sources into controlled documents",
  "RFP Response": "Research Document",
  "Security Questionnaire": "Security Assessment",
  "Vendor Due Diligence": "Due Diligence Document",
  "Blank Response": "Blank Document",
  "Drop an RFP here to start a response": "Drop a document here to start a project",
  "No responses yet": "No documents yet",
  "Response setup": "Document setup",
  "Upload the RFP first": "Upload a source document first",
  "Export response": "Export document",
  "All responses": "All documents",
  "Response Defaults": "Document Defaults",
} as const;
