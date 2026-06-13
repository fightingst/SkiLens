import type { NormalizedSkill, SkillCategory, SkillPayload, SummaryPayload, TimeRange, TrendDay } from '../types';

export const TIME_RANGES: TimeRange[] = ['今天', '7天', '30天', '全部'];
export const COLD_START_CALL_THRESHOLD = 5;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_TREND_DAYS = 30;
const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
const INVOCATION_SIGNALS = new Set(['slash-command', 'skill-tool']);

export const CATEGORIES: Record<SkillCategory, { label: string; color: string; icon: string }> = {
  office: { label: '办公协作', color: '#00B8A9', icon: '◈' },
  design: { label: '设计视觉', color: '#FF6B9D', icon: '◐' },
  writing: { label: '内容写作', color: '#AF52DE', icon: '✎' },
  eng: { label: '开发工程', color: '#007AFF', icon: '⌘' },
  auto: { label: '自动化', color: '#FF9500', icon: '⚡' },
  search: { label: '搜索数据', color: '#34C759', icon: '◉' },
  tools: { label: '工具管理', color: '#5856D6', icon: '◇' },
  testing: { label: '测试评测', color: '#FF3B30', icon: '◎' },
  other: { label: '其他', color: '#8E8E93', icon: '○' },
};

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, offset: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + offset);
  return next;
}

function dayKey(date: Date): string {
  return startOfDay(date).toISOString().slice(0, 10);
}

function parseTimestamp(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysAgoLabel(timestamp: string, today: Date): string {
  const date = parseTimestamp(timestamp);
  if (!date) return '从未使用';
  const diff = Math.max(0, Math.round((startOfDay(today).getTime() - startOfDay(date).getTime()) / MS_PER_DAY));
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return `${diff} 天前`;
}

function shortDescription(text: string): string {
  if (!text) return '暂无描述';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 3 || !/[A-Za-z0-9\u4e00-\u9fff]/.test(cleaned)) return '暂无描述';
  return cleaned.slice(0, 140);
}

function sourceText(skill: SkillPayload): string {
  return (skill.sources || []).map((source) => `${source.origin || ''} ${source.path || ''}`).join(' ');
}

export function classifySkill(skill: SkillPayload): SkillCategory {
  const name = skill.name.toLowerCase();
  const text = `${name} ${skill.description || ''} ${sourceText(skill)}`.toLowerCase();
  if (/feishu|lark|slack|notion|obsidian|calendar|meeting|docs?|wiki|base|drive|sheet|spreadsheet|presentation|permission|workspace|飞书|文档|知识库|云盘|多维表格|表格|会议|日历|权限|协作|办公/.test(text)) return 'office';
  if (/image|design|cover|infographic|illustrator|figma|canvas|poster|xhs|视觉|图片|图像|设计|白板|海报|封面|配图|diagram|draw/.test(text)) return 'design';
  if (/writing|writer|humanizer|markdown|article|content|translate|copywriting|blog|newsletter|wechat|写作|润色|文本|文章|翻译|公众号|小红书|文案|摘要/.test(text)) return 'writing';
  if (/java|dev|code|mr-|review|engineering|architecture|tdd|workflow|git|repo|test-browser|coding|开发|代码|架构|规范/.test(text)) return 'eng';
  if (/browser|chrome|computer|desktop|automation|playwright|agent|event|task|自动化|浏览器|桌面|任务/.test(text)) return 'auto';
  if (/search|mysql|postgres|database|sql|data|graph|ocr|extract|research|web|crawler|scrape|数据库|搜索|数据|提取|知识图谱|检索|爬取|调研/.test(text)) return 'search';
  if (/eval|test|benchmark|mimo|harness|评测|测试/.test(text)) return 'testing';
  if (/skill|plugin|install|creator|workflow|setup|tool|管理|安装/.test(text)) return 'tools';
  return 'other';
}

function makeDayBucket(date: Date): TrendDay {
  return {
    key: dayKey(date),
    date: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
    weekday: WEEKDAY_NAMES[date.getUTCDay()] || '',
    calls: 0,
  };
}

function makeEmptyTrend(today: Date): TrendDay[] {
  const days: TrendDay[] = [];
  for (let i = DEFAULT_TREND_DAYS - 1; i >= 0; i -= 1) {
    days.push(makeDayBucket(addDays(today, -i)));
  }
  return days;
}

function invocationEvents(skill: SkillPayload) {
  const slashSessions = new Set(
    (skill.events || [])
      .filter((event) => event.signal === 'slash-command' && event.session_id)
      .map((event) => event.session_id),
  );
  return (skill.events || []).filter((event) => {
    if (!INVOCATION_SIGNALS.has(event.signal)) return false;
    if (event.signal === 'skill-tool' && event.session_id && slashSessions.has(event.session_id)) return false;
    return true;
  });
}

function buildTrend(skill: SkillPayload, today: Date): TrendDay[] {
  const trend = makeEmptyTrend(today);
  const byKey = Object.fromEntries(trend.map((day) => [day.key, day]));
  if (skill.dailyInvocations) {
    Object.entries(skill.dailyInvocations).forEach(([key, calls]) => {
      if (byKey[key]) byKey[key].calls += Number(calls || 0);
    });
    return trend;
  }
  invocationEvents(skill).forEach((event) => {
    const date = parseTimestamp(event.timestamp);
    if (!date) return;
    const key = dayKey(date);
    if (byKey[key]) byKey[key].calls += 1;
  });
  return trend;
}

function buildAllTrend(skill: SkillPayload, today: Date): TrendDay[] {
  if (skill.dailyInvocations && Object.keys(skill.dailyInvocations).length > 0) {
    const keys = Object.keys(skill.dailyInvocations).sort();
    const firstDate = parseTimestamp(`${keys[0]}T00:00:00Z`);
    const lastKeyDate = parseTimestamp(`${keys[keys.length - 1]}T00:00:00Z`);
    if (!firstDate || !lastKeyDate) return [];
    const last = startOfDay(lastKeyDate) > today ? startOfDay(lastKeyDate) : today;
    const days: TrendDay[] = [];
    for (let d = startOfDay(firstDate); d <= last; d = addDays(d, 1)) {
      const bucket = makeDayBucket(d);
      bucket.calls = Number(skill.dailyInvocations[bucket.key] || 0);
      days.push(bucket);
    }
    return days;
  }
  const dates = invocationEvents(skill)
    .map((event) => parseTimestamp(event.timestamp))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime());
  if (!dates.length) return [];
  const first = startOfDay(dates[0]);
  const lastEventDay = startOfDay(dates[dates.length - 1]);
  const last = lastEventDay > today ? lastEventDay : today;
  const days: TrendDay[] = [];
  for (let d = new Date(first); d <= last; d = addDays(d, 1)) {
    days.push(makeDayBucket(d));
  }
  const byKey = Object.fromEntries(days.map((day) => [day.key, day]));
  dates.forEach((date) => {
    const bucket = byKey[dayKey(date)];
    if (bucket) bucket.calls += 1;
  });
  return days;
}

export function normalizeSkills(payload: SummaryPayload): NormalizedSkill[] {
  const generatedAt = parseTimestamp(payload.generatedAt);
  const today = startOfDay(generatedAt || new Date());
  return (payload.skills || [])
    .map((skill) => {
      const trend = buildTrend(skill, today);
      const allTrend = buildAllTrend(skill, today);
      const calls30 = trend.reduce((sum, day) => sum + day.calls, 0);
      const lastInvoked = skill.lastInvoked || '';
      return {
        name: skill.name,
        cat: classifySkill(skill),
        desc: shortDescription(skill.description),
        calls30,
        callsTotal: Number(skill.invocations || 0),
        evidence: Number(skill.confirmed || 0) + Number(skill.probable || 0),
        status: skill.status,
        lastUsed: daysAgoLabel(lastInvoked, today),
        lastSeen: skill.lastSeen || '',
        lastInvoked,
        sessions: Number(skill.sessionCount || 0),
        available: Number(skill.available || 0),
        loaded: Number(skill.loaded || 0),
        sources: skill.sources || [],
        installed: (skill.sources || []).length > 0,
        events: skill.events || [],
        trend,
        allTrend,
      } satisfies NormalizedSkill;
    })
    .sort((a, b) => b.calls30 - a.calls30 || b.callsTotal - a.callsTotal || a.name.localeCompare(b.name));
}

export function callsForRange(skill: NormalizedSkill, range: TimeRange): number {
  if (range === '今天') return skill.trend[skill.trend.length - 1]?.calls || 0;
  if (range === '7天') return skill.trend.slice(-7).reduce((sum, day) => sum + day.calls, 0);
  if (range === '全部') return skill.callsTotal || 0;
  return skill.calls30 || 0;
}

export function aggregateTimeline(skills: NormalizedSkill[], range: TimeRange): TrendDay[] {
  if (range === '全部') {
    const keys = new Map<string, TrendDay>();
    skills.forEach((skill) => {
      skill.allTrend.forEach((day) => {
        const bucket = keys.get(day.key) || { ...day, calls: 0 };
        bucket.calls += day.calls;
        keys.set(day.key, bucket);
      });
    });
    return Array.from(keys.values()).sort((a, b) => a.key.localeCompare(b.key));
  }
  const length = range === '今天' ? 1 : range === '7天' ? 7 : 30;
  const template = skills[0]?.trend.slice(-length) || [];
  return template.map((day, index) => ({
    ...day,
    calls: skills.reduce((sum, skill) => sum + (skill.trend.slice(-length)[index]?.calls || 0), 0),
  }));
}
