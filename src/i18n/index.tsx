import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type MessageKey } from './en';
import { ja } from './ja';
import { zhCN } from './zh-CN';
import { zhTW } from './zh-TW';

export type Locale = 'en' | 'zh-TW' | 'zh-CN' | 'ja';

export const LOCALE_STORAGE_KEY = 'beatforge.locale';
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'zh-TW', 'zh-CN', 'ja'];

export const messages = Object.freeze({
  en,
  'zh-TW': zhTW,
  'zh-CN': zhCN,
  ja,
});

export function normalizeLocale(raw?: string | null): Locale {
  const value = (raw ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!value) return 'en';

  if (value === 'zh-tw' || value === 'zh-hk' || value === 'zh-mo' || value.includes('hant')) {
    return 'zh-TW';
  }
  if (value === 'zh-cn' || value === 'zh-sg' || value.includes('hans') || value === 'zh') {
    return 'zh-CN';
  }
  if (value === 'ja' || value.startsWith('ja-')) return 'ja';
  if (value === 'en' || value.startsWith('en-')) return 'en';
  return 'en';
}

function loadInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && SUPPORTED_LOCALES.includes(stored as Locale)) return stored as Locale;
  } catch {
    // Storage is optional.
  }

  if (typeof navigator !== 'undefined') {
    const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const candidate of candidates) {
      const normalized = normalizeLocale(candidate);
      if (normalized !== 'en' || candidate?.toLowerCase().startsWith('en')) return normalized;
    }
  }

  return 'en';
}

function interpolate(template: string, variables?: Record<string, string | number>) {
  if (!variables) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const value = variables[key];
    return value === undefined ? match : String(value);
  });
}

export function intlLocale(locale: Locale) {
  return locale === 'zh-TW' ? 'zh-Hant-TW' : locale === 'zh-CN' ? 'zh-Hans-CN' : locale;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, variables?: Record<string, string | number>) => string;
  number: (value: number) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(loadInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Storage is optional.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = intlLocale(locale);
  }, [locale]);

  const t = useCallback((key: MessageKey, variables?: Record<string, string | number>) => {
    const dictionary = messages[locale];
    const template = dictionary[key] ?? en[key] ?? key;
    return interpolate(template, variables);
  }, [locale]);

  const number = useCallback((value: number) => value.toLocaleString(intlLocale(locale)), [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t,
    number,
  }), [locale, number, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}

export function localeLabelKey(locale: Locale): MessageKey {
  if (locale === 'zh-TW') return 'language.zhTW';
  if (locale === 'zh-CN') return 'language.zhCN';
  if (locale === 'ja') return 'language.ja';
  return 'language.en';
}

export type { MessageKey } from './en';
