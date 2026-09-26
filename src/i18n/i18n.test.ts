import { describe, expect, it } from 'vitest';
import { en } from './en';
import { messages, normalizeLocale, SUPPORTED_LOCALES } from './index';

describe('BeatForge i18n isolation', () => {
  it('keeps every locale on the exact canonical key set', () => {
    const canonical = Object.keys(en).sort();

    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(messages[locale]).sort()).toEqual(canonical);
    }
  });

  it('keeps locale dictionaries isolated instead of merging objects', () => {
    expect(messages.en).not.toBe(messages['zh-TW']);
    expect(messages.en).not.toBe(messages['zh-CN']);
    expect(messages.en).not.toBe(messages.ja);
    expect(messages['zh-TW']).not.toBe(messages['zh-CN']);
  });

  it('normalizes browser locale variants deterministically', () => {
    expect(normalizeLocale('zh-HK')).toBe('zh-TW');
    expect(normalizeLocale('zh-Hant')).toBe('zh-TW');
    expect(normalizeLocale('zh-CN')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hans-SG')).toBe('zh-CN');
    expect(normalizeLocale('ja-JP')).toBe('ja');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('fr-FR')).toBe('en');
  });
});
