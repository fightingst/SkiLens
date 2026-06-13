import { CATEGORY_KEYS } from '../constants';
import { aggregateTimeline, callsForRange } from './data';
import type { NormalizedSkill, SkillCategory, SummaryPayload, TimeRange, TrendDay } from '../types';

export function rangeLabel(range: TimeRange) {
  if (range === '今天') return '今日';
  if (range === '全部') return '全时间';
  return range;
}

export function daysScope(range: TimeRange) {
  if (range === '今天') return '今日中';
  if (range === '7天') return '7 天中';
  if (range === '全部') return '全时间中';
  return '30 天中';
}

export function trendForRange(skill: NormalizedSkill, range: TimeRange): TrendDay[] {
  if (range === '今天') return skill.trend.slice(-1);
  if (range === '7天') return skill.trend.slice(-7);
  if (range === '全部') return skill.allTrend;
  return skill.trend;
}

export function aggregateTimelineFromTemplate(skills: NormalizedSkill[], templateSkills: NormalizedSkill[], range: TimeRange): TrendDay[] {
  if (skills.length > 0) return aggregateTimeline(skills, range);
  const template = aggregateTimeline(templateSkills, range);
  return template.map((day) => ({ ...day, calls: 0 }));
}

export function categoryStats(skills: NormalizedSkill[], range: TimeRange) {
  const stats = Object.fromEntries(CATEGORY_KEYS.map((key) => [key, { count: 0, calls: 0, neverUsed: 0 }])) as Record<SkillCategory, { count: number; calls: number; neverUsed: number }>;
  skills.forEach((skill) => {
    stats[skill.cat].count += 1;
    stats[skill.cat].calls += callsForRange(skill, range);
    if (skill.callsTotal === 0) stats[skill.cat].neverUsed += 1;
  });
  return stats;
}

export function scanAgeLabel(timestamp?: string): string {
  if (!timestamp) return '尚未扫描';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '尚未扫描';
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function emptyPayload(): SummaryPayload {
  return {
    generatedAt: '',
    totals: {},
    stats: {},
    skillRoots: [],
    logRoots: {},
    skills: [],
  };
}
