import { invoke } from '@tauri-apps/api/core';
import type { ArchivePayload, SkillMdPayload, SummaryPayload } from '../types';

type RescanPayload = {
  generatedAt: string;
};

const browserArchiveState = new Set<string>();

function hasTauriIpc(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function emptySummary(): SummaryPayload {
  return {
    generatedAt: '',
    totals: {},
    stats: {},
    skillRoots: [],
    logRoots: {},
    skills: [],
  };
}

export function getDashboardData(): Promise<SummaryPayload> {
  if (!hasTauriIpc()) return Promise.resolve(emptySummary());
  return invoke('get_dashboard_data');
}

export function rescan(): Promise<RescanPayload> {
  if (!hasTauriIpc()) return Promise.resolve({ generatedAt: '' });
  return invoke('rescan');
}

export function getArchives(): Promise<ArchivePayload> {
  if (!hasTauriIpc()) return Promise.resolve({ skills: Array.from(browserArchiveState).sort(), updatedAt: '' });
  return invoke('get_archives');
}

export function archiveSkill(name: string): Promise<ArchivePayload> {
  if (!hasTauriIpc()) {
    browserArchiveState.add(name);
    return getArchives();
  }
  return invoke('archive_skill', { name });
}

export function archiveSkills(names: string[]): Promise<ArchivePayload> {
  if (!hasTauriIpc()) {
    names.forEach((name) => browserArchiveState.add(name));
    return getArchives();
  }
  return invoke('archive_skills', { names });
}

export function deleteSkill(name: string): Promise<{ moved: Array<{ from: string; to: string }>; archive: ArchivePayload; warning?: string }> {
  if (!hasTauriIpc()) {
    browserArchiveState.add(name);
    return getArchives().then((archive) => ({ moved: [], archive, warning: 'browser preview only' }));
  }
  return invoke('delete_skill', { name });
}

export function readSkillMd(name: string): Promise<SkillMdPayload> {
  if (!hasTauriIpc()) return Promise.reject(new Error(`SKILL.md is only available inside the Tauri app (${name})`));
  return invoke('read_skill_md', { name });
}

export function revealSkillMd(name: string): Promise<{ path: string }> {
  if (!hasTauriIpc()) return Promise.reject(new Error(`Finder reveal is only available inside the Tauri app (${name})`));
  return invoke('reveal_skill_md', { name });
}
