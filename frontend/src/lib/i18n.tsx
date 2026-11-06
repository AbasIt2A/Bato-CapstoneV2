import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { type Lang, LANGS, STRINGS, type Strings } from "./strings";

// Language choice for the screens in strings.ts. Remembered per browser so a
// participant who picks Bisaya on the consent screen keeps it on every page.

const KEY = "bato-lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGS.some((l) => l.code === saved)) return saved as Lang;
  } catch {
    // storage unavailable — fall back to English
  }
  return "en";
}

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Strings;
}

const I18nContext = createContext<I18n | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  function setLang(next: Lang) {
    setLangState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // not remembered — still applies for this visit
    }
  }

  return (
    <I18nContext.Provider value={{ lang, setLang, t: STRINGS[lang] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside LanguageProvider");
  return ctx;
}

export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="language-switcher" role="group" aria-label={t.languageLabel}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          lang={l.code}
          aria-pressed={lang === l.code}
          onClick={() => setLang(l.code)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
