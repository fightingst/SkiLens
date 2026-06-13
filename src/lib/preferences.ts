import { CATEGORY_KEYS, DEFAULT_PREFERENCES, MAX_SEARCH_HISTORY_ITEM_LENGTH, MAX_SEARCH_HISTORY_ITEMS, PREFERENCES_STORAGE_KEY, THEMES } from '../constants';
import { TIME_RANGES } from './data';
import type { Preferences } from '../constants';
import type { SkillCategory, TimeRange, ViewKey } from '../types';

export function sanitizePreferences(value: unknown): Preferences {
  const raw = value && typeof value === 'object' ? value as Partial<Preferences> : {};
  const history = Array.isArray(raw.searchHistory) ? raw.searchHistory : [];
  const cleanedHistory: string[] = [];
  const seen = new Set<string>();
  history.forEach((item) => {
    const text = String(item || '').trim();
    if (!text || seen.has(text)) return;
    cleanedHistory.push(text.slice(0, MAX_SEARCH_HISTORY_ITEM_LENGTH));
    seen.add(text);
  });
  return {
    defaultRange: TIME_RANGES.includes(raw.defaultRange as TimeRange) ? raw.defaultRange as TimeRange : DEFAULT_PREFERENCES.defaultRange,
    theme: THEMES.includes(raw.theme as Preferences['theme']) ? raw.theme as Preferences['theme'] : DEFAULT_PREFERENCES.theme,
    scanTrigger: 'manual',
    searchHistory: cleanedHistory.slice(0, MAX_SEARCH_HISTORY_ITEMS),
  };
}

export function loadPreferences(): Preferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    return sanitizePreferences(JSON.parse(window.localStorage.getItem(PREFERENCES_STORAGE_KEY) || 'null'));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferencesToStorage(preferences: Preferences) {
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Local storage can be unavailable in restricted WebViews; preferences stay in memory.
  }
}

export function applyThemePreference(theme: Preferences['theme']) {
  document.documentElement.dataset.theme = THEMES.includes(theme) ? theme : DEFAULT_PREFERENCES.theme;
}

export function readInitialRoute(): { view: ViewKey; category: SkillCategory | 'all'; skillName: string } {
  if (typeof window === 'undefined') return { view: 'overview', category: 'all', skillName: '' };
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const cat = params.get('cat');
  const skillName = params.get('skill') || '';
  if (view === 'coldstart') return { view: 'coldstart', category: 'all', skillName: '' };
  if (view === 'category' && cat && CATEGORY_KEYS.includes(cat as SkillCategory)) {
    return { view: 'category', category: cat as SkillCategory, skillName: '' };
  }
  if (view === 'detail' && skillName) return { view: 'detail', category: 'all', skillName };
  return { view: 'overview', category: 'all', skillName: '' };
}
