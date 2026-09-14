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
