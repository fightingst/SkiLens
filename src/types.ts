export type TimeRange = '今天' | '7天' | '30天' | '全部';
export type SkillCategory = 'office' | 'design' | 'writing' | 'eng' | 'auto' | 'search' | 'tools' | 'testing' | 'other';
export type ViewKey = 'overview' | 'category' | 'coldstart' | 'detail' | 'list';

export interface SkillSource {
  path: string;
  platform: string;
  origin: string;
}

export interface SkillEvent {
  skill: string;
  platform: string;
  confidence: string;
  signal: string;
  timestamp: string;
  session_id: string;
  log_file: string;
  detail: string;
}

export interface SkillPayload {
  name: string;
  description: string;
  status: string;
  confirmed: number;
  probable: number;
  loaded: number;
  invocations: number;
  available: number;
  sessionCount: number;
  loadedSessionCount: number;
  availableSessionCount: number;
  allSessionCount: number;
  lastSeen: string;
  lastInvoked: string;
  dailyInvocations?: Record<string, number>;
  sources: SkillSource[];
  events: SkillEvent[];
}

export interface SummaryPayload {
  generatedAt: string;
  totals: Record<string, number>;
  stats: Record<string, Record<string, number>>;
  skillRoots: string[];
  logRoots: Record<string, string[]>;
  skills: SkillPayload[];
}

export interface ArchivePayload {
  skills: string[];
  updatedAt: string;
}

export interface SkillMdPayload {
  name: string;
  files: Array<{
    path: string;
    content?: string;
    error?: string;
  }>;
}

export interface TrendDay {
  key: string;
  date: string;
  weekday: string;
  calls: number;
}

export interface NormalizedSkill {
  name: string;
  cat: SkillCategory;
  desc: string;
  calls30: number;
  callsTotal: number;
  evidence: number;
  status: string;
  lastUsed: string;
  lastSeen: string;
  lastInvoked: string;
  sessions: number;
  available: number;
  loaded: number;
  sources: SkillSource[];
  installed: boolean;
  events: SkillEvent[];
  trend: TrendDay[];
  allTrend: TrendDay[];
}
