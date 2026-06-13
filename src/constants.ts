import { CATEGORIES } from './lib/data';
import type { SkillCategory, TimeRange } from './types';

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as SkillCategory[];
export const INSTALL_FILTERS = ['all', 'installed', 'archived'] as const;
export type InstallFilter = (typeof INSTALL_FILTERS)[number];
export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEMES)[number];
export const MAX_SEARCH_HISTORY_ITEM_LENGTH = 80;
export const MAX_SEARCH_HISTORY_ITEMS = 5;
export const PREFERENCES_STORAGE_KEY = 'skilens.preferences.v1';
export const DRAG_START_THRESHOLD_PX = 6;
export const DRAG_SCROLL_EDGE_PX = 60;
export const DRAG_SCROLL_MAX_STEP_PX = 12;
export const RANKING_LIMIT = 10;
export const COLD_START_PREVIEW_LIMIT = 5;

export type Preferences = {
  defaultRange: TimeRange;
  theme: ThemePreference;
  scanTrigger: 'manual';
  searchHistory: string[];
};

export const DEFAULT_PREFERENCES: Preferences = {
  defaultRange: '30天',
  theme: 'system',
  scanTrigger: 'manual',
  searchHistory: [],
};
