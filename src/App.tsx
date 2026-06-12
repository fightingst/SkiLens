import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { confirm } from '@tauri-apps/plugin-dialog';
import { Archive, ChevronLeft, FolderOpen, Info, Trash2, X } from 'lucide-react';
import { archiveSkill, archiveSkills, deleteSkill, getArchives, getDashboardData, readSkillMd, rescan, revealSkillMd } from './lib/api';
import { aggregateTimeline, callsForRange, CATEGORIES, COLD_START_CALL_THRESHOLD, normalizeSkills, TIME_RANGES } from './lib/data';
import type { NormalizedSkill, SkillCategory, SkillMdPayload, TimeRange, TrendDay, ViewKey } from './types';

const CATEGORY_KEYS = Object.keys(CATEGORIES) as SkillCategory[];
const MAC_WINDOW_SIZE = { width: 1280, height: 820 };
const INSTALL_FILTERS = ['all', 'installed', 'archived'] as const;
type InstallFilter = (typeof INSTALL_FILTERS)[number];
const THEMES = ['system', 'light', 'dark'] as const;
type ThemePreference = (typeof THEMES)[number];
const MAX_SEARCH_HISTORY_ITEM_LENGTH = 80;
const MAX_SEARCH_HISTORY_ITEMS = 5;
const PREFERENCES_STORAGE_KEY = 'skilens.preferences.v1';
const DRAG_START_THRESHOLD_PX = 6;
const DRAG_SCROLL_EDGE_PX = 60;
const DRAG_SCROLL_MAX_STEP_PX = 12;
const RANKING_LIMIT = 10;
const COLD_START_PREVIEW_LIMIT = 5;

type Preferences = {
  defaultRange: TimeRange;
  theme: ThemePreference;
  scanTrigger: 'manual';
  searchHistory: string[];
};

const DEFAULT_PREFERENCES: Preferences = {
  defaultRange: '30天',
  theme: 'system',
  scanTrigger: 'manual',
  searchHistory: [],
};

function sanitizePreferences(value: unknown): Preferences {
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
    theme: THEMES.includes(raw.theme as ThemePreference) ? raw.theme as ThemePreference : DEFAULT_PREFERENCES.theme,
    scanTrigger: 'manual',
    searchHistory: cleanedHistory.slice(0, MAX_SEARCH_HISTORY_ITEMS),
  };
}

function loadPreferences(): Preferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    return sanitizePreferences(JSON.parse(window.localStorage.getItem(PREFERENCES_STORAGE_KEY) || 'null'));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function savePreferencesToStorage(preferences: Preferences) {
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Local storage can be unavailable in restricted WebViews; preferences stay in memory.
  }
}

function applyThemePreference(theme: ThemePreference) {
  document.documentElement.dataset.theme = THEMES.includes(theme) ? theme : DEFAULT_PREFERENCES.theme;
}

function readInitialRoute(): { view: ViewKey; category: SkillCategory | 'all'; skillName: string } {
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

export function App() {
  const queryClient = useQueryClient();
  const initialPreferences = useMemo(() => loadPreferences(), []);
  const initialRoute = useMemo(() => readInitialRoute(), []);
  const [view, setView] = useState<ViewKey>(initialRoute.view);
  const [prevView, setPrevView] = useState<ViewKey>('overview');
  const [activeCategory, setActiveCategory] = useState<SkillCategory | 'all'>(initialRoute.category);
  const [activeSkillName, setActiveSkillName] = useState(initialRoute.skillName);
  const [search, setSearch] = useState('');
  const [preferences, setPreferences] = useState<Preferences>(initialPreferences);
  const [range, setRange] = useState<TimeRange>(initialPreferences.defaultRange);
  const [notice, setNotice] = useState<{ type: 'info' | 'success' | 'error'; title: string; message?: string } | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: getDashboardData });
  const archives = useQuery({ queryKey: ['archives'], queryFn: getArchives });
  const archivedSet = useMemo(() => new Set(archives.data?.skills || []), [archives.data]);
  const skills = useMemo(() => normalizeSkills(dashboard.data || emptyPayload()), [dashboard.data]);
  const visibleSkills = useMemo(() => skills.filter((skill) => !archivedSet.has(skill.name)), [archivedSet, skills]);
  const filteredSkills = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleSkills
      .map((skill) => ({ ...skill, calls30: callsForRange(skill, range) }))
      .filter((skill) => activeCategory === 'all' || skill.cat === activeCategory)
      .filter((skill) => !q || skill.name.toLowerCase().includes(q) || skill.desc.toLowerCase().includes(q))
      .sort((a, b) => callsForRange(b, range) - callsForRange(a, range) || b.callsTotal - a.callsTotal || a.name.localeCompare(b.name));
  }, [activeCategory, range, search, visibleSkills]);
  const searchedVisibleSkills = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleSkills
      .map((skill) => ({ ...skill, calls30: callsForRange(skill, range) }))
      .filter((skill) => !q || skill.name.toLowerCase().includes(q) || skill.desc.toLowerCase().includes(q));
  }, [range, search, visibleSkills]);
  const activeSkill = skills.find((skill) => skill.name === activeSkillName);

  const scanMutation = useMutation({
    mutationFn: rescan,
    onMutate: () => setNotice({ type: 'info', title: '正在重新扫描', message: '页面会在完成后原地更新。' }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['archives'] }),
      ]);
      setNotice({ type: 'success', title: '扫描完成', message: '数据已原地更新。' });
    },
    onError: (error) => setNotice({ type: 'error', title: '扫描失败', message: String(error) }),
  });

  useEffect(() => {
    applyThemePreference(preferences.theme);
    savePreferencesToStorage(preferences);
  }, [preferences]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        setPreferencesOpen(true);
      }
      if (event.key === 'Escape' && preferencesOpen) {
        event.preventDefault();
        setPreferencesOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preferencesOpen]);

  const updatePreferences = (patch: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = sanitizePreferences({ ...current, ...patch });
      if (patch.defaultRange) setRange(next.defaultRange);
      return next;
    });
  };

  const commitSearch = (term: string) => {
    const text = term.trim();
    if (!text) return;
    updatePreferences({
      searchHistory: [text, ...preferences.searchHistory.filter((item) => item !== text)].slice(0, MAX_SEARCH_HISTORY_ITEMS),
    });
  };

  const refreshDashboardState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['archives'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
  };

  const archiveFromList = async (name: string) => {
    await archiveSkill(name);
    await refreshDashboardState();
    setNotice({ type: 'success', title: '已归档隐藏', message: name });
  };

  const deleteFromList = async (name: string) => {
    const result = await deleteSkill(name);
    await refreshDashboardState();
    setNotice({
      type: 'success',
      title: result.moved.length > 0 ? '删除完成' : '已归档隐藏',
      message: result.moved.length > 0 ? `已移动 ${result.moved.length} 个目录到废纸篓。` : name,
    });
  };

  const archiveManyFromList = async (names: string[]) => {
    if (!names.length) return;
    await archiveSkills(names);
    await refreshDashboardState();
    setNotice({ type: 'success', title: '批量归档完成', message: `已归档隐藏 ${names.length} 个 skill。` });
  };

  const deleteManyFromList = async (names: string[]) => {
    if (!names.length) return;
    const results = await Promise.allSettled(names.map((name) => deleteSkill(name)));
    await refreshDashboardState();
    const success = results.filter((result) => result.status === 'fulfilled');
    const moved = success.reduce((sum, result) => sum + (result.status === 'fulfilled' ? result.value.moved.length : 0), 0);
    const failed = results.length - success.length;
    const failedText = failed > 0 ? `，${failed} 个失败` : '';
    setNotice({
      type: failed > 0 ? 'error' : 'success',
      title: '批量删除完成',
      message: `已处理 ${success.length} 个 skill，移动 ${moved} 个目录到废纸篓${failedText}。`,
    });
  };

  const selectCategory = (category: SkillCategory | 'all') => {
    setActiveCategory(category);
    setView(category === 'all' ? 'overview' : 'category');
  };

  const openSkill = (skill: NormalizedSkill) => {
    if (view !== 'detail') setPrevView(view);
    setActiveSkillName(skill.name);
    setView('detail');
  };

  const backFromDetail = () => {
    setView(prevView);
    setActiveSkillName('');
    setPrevView('overview');
  };

  const navItems = [
    { key: 'all', label: '全部 Skills', icon: '◎', count: visibleSkills.length },
    {
      key: 'coldstart',
      label: '冷启动发现',
      icon: '⚠',
      count: visibleSkills.filter((skill) => callsForRange(skill, range) <= COLD_START_CALL_THRESHOLD).length,
    },
  ];

  return (
    <MacWindow
      width={MAC_WINDOW_SIZE.width}
      height={MAC_WINDOW_SIZE.height}
      sidebar={
        <Sidebar
          navItems={navItems}
          view={view}
          activeCategory={activeCategory}
          skills={visibleSkills}
          range={range}
          scanBusy={scanMutation.isPending}
          scanLabel={notice?.title || scanAgeLabel(dashboard.data?.generatedAt)}
          onSelectCategory={selectCategory}
          onColdStart={() => setView('coldstart')}
          onRescan={() => scanMutation.mutate()}
          onOpenPreferences={() => setPreferencesOpen(true)}
        />
      }
    >
      <Toolbar
        range={range}
        search={search}
        onRange={setRange}
        onSearch={setSearch}
        onSearchCommit={commitSearch}
        searchHistory={preferences.searchHistory}
      />
      <main className="content">
        {dashboard.isLoading && <EmptyState title="加载中" subtitle="正在读取本地扫描数据" />}
        {dashboard.error && <EmptyState title="读取失败" subtitle={String(dashboard.error)} />}
        {!dashboard.isLoading && !dashboard.error && view === 'overview' && (
          <OverviewView skills={filteredSkills} timelineSourceSkills={visibleSkills} range={range} onOpen={openSkill} onSelectCategory={selectCategory} onColdStart={() => setView('coldstart')} />
        )}
        {!dashboard.isLoading && !dashboard.error && view === 'category' && (
          <CategoryView category={activeCategory} skills={filteredSkills} range={range} onOpen={openSkill} />
        )}
        {!dashboard.isLoading && !dashboard.error && view === 'coldstart' && (
          <ColdStartView
            skills={searchedVisibleSkills}
            range={range}
            onOpen={openSkill}
            onArchive={archiveFromList}
            onDelete={deleteFromList}
            onArchiveMany={archiveManyFromList}
            onDeleteMany={deleteManyFromList}
          />
        )}
        {!dashboard.isLoading && !dashboard.error && view === 'detail' && activeSkill && (
          <SkillDetail
            skill={activeSkill}
            skills={visibleSkills}
            range={range}
            onBack={backFromDetail}
            onOpen={openSkill}
            onArchive={archiveFromList}
            onDelete={deleteFromList}
          />
        )}
        {!dashboard.isLoading && !dashboard.error && view === 'detail' && !activeSkill && (
          <div className="view view-entrance">
            <EmptyState title="Skill 不在当前数据中" subtitle="它可能已被归档、删除或重新扫描后不再出现。" />
            <button className="detail-action detail-action--primary" onClick={backFromDetail}>返回</button>
          </div>
        )}
      </main>
      {notice && <ScanNotice notice={notice} />}
      {preferencesOpen && (
        <PreferencesModal
          preferences={preferences}
          archivedCount={archivedSet.size}
          onChange={updatePreferences}
          onClose={() => setPreferencesOpen(false)}
        />
      )}
    </MacWindow>
  );
}

function Sidebar({
  navItems,
  view,
  activeCategory,
  skills,
  range,
  scanBusy,
  scanLabel,
  onSelectCategory,
  onColdStart,
  onRescan,
  onOpenPreferences,
}: {
  navItems: Array<{ key: string; label: string; icon: string; count: number }>;
  view: ViewKey;
  activeCategory: SkillCategory | 'all';
  skills: NormalizedSkill[];
  range: TimeRange;
  scanBusy: boolean;
  scanLabel: string;
  onSelectCategory: (category: SkillCategory | 'all') => void;
  onColdStart: () => void;
  onRescan: () => void;
  onOpenPreferences: () => void;
}) {
  return (
    <div className="sidebar-inner">
      <div className="sidebar-main">
        <div className="sidebar-section">
          {navItems.map((item) => {
            const active = item.key === 'coldstart' ? view === 'coldstart' : view === 'overview' && activeCategory === 'all';
            return (
              <button key={item.key} className={`sidebar-item ${active ? 'sidebar-item--active' : ''}`} onClick={item.key === 'coldstart' ? onColdStart : () => onSelectCategory('all')}>
                <span className="sidebar-item__icon" style={{ color: item.key === 'coldstart' ? '#FF9500' : '#007AFF' }}>{item.icon}</span>
                <span className="sidebar-item__label">{item.label}</span>
                <span className="sidebar-item__count">{item.count}</span>
              </button>
            );
          })}
        </div>
        <div className="sidebar-section">
          <MacSidebarHeader title="分类" />
          {CATEGORY_KEYS.map((key) => {
            const count = skills.filter((skill) => skill.cat === key).length;
            const meta = CATEGORIES[key];
            return (
              <button key={key} className={`sidebar-item ${view === 'category' && activeCategory === key ? 'sidebar-item--active' : ''}`} onClick={() => onSelectCategory(key)}>
                <span className="sidebar-item__icon" style={{ color: meta.color }}>{meta.icon}</span>
                <span className="sidebar-item__label">{meta.label}</span>
                <span className="sidebar-item__count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="sidebar-scan">
        <span className="sidebar-scan__meta">上次扫描：{scanBusy ? '扫描中...' : scanLabel}</span>
        <div className="sidebar-scan__actions">
          <button className="sidebar-scan__btn" onClick={onRescan} disabled={scanBusy}>重新扫描</button>
          <button className="sidebar-scan__btn sidebar-scan__btn--icon" onClick={onOpenPreferences} aria-label="偏好设置">
            <span className="sidebar-scan__gear">⚙</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Toolbar({
  range,
  search,
  searchHistory,
  onRange,
  onSearch,
  onSearchCommit,
}: {
  range: TimeRange;
  search: string;
  searchHistory: string[];
  onRange: (range: TimeRange) => void;
  onSearch: (value: string) => void;
  onSearchCommit: (value: string) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const commit = (value = search) => onSearchCommit(value);
  return (
    <div className="custom-toolbar" data-tauri-drag-region>
      <div className="custom-toolbar__right">
        <div className="seg-control" role="group" aria-label="时间范围">
          {TIME_RANGES.map((item) => (
            <button key={item} className={`seg-control__item ${range === item ? 'seg-control__item--active' : ''}`} aria-pressed={range === item} onClick={() => onRange(item)}>
              {item}
            </button>
          ))}
        </div>
        <div className="search-combo">
          <label className="search-box" htmlFor="skill-search">
            <span>⌕</span>
            <input
              id="skill-search"
              name="skill-search"
              className="search-box__input"
              placeholder="搜索 skill"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              onFocus={() => setHistoryOpen(true)}
              onBlur={() => {
                commit();
                window.setTimeout(() => setHistoryOpen(false), 120);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commit(event.currentTarget.value);
                  setHistoryOpen(false);
                }
              }}
            />
          </label>
          {historyOpen && searchHistory.length > 0 && (
            <div className="search-history">
              {searchHistory.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="search-history__item"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSearch(item);
                    commit(item);
                    setHistoryOpen(false);
                  }}
                >
                  <span>◷</span>
                  <span>{item}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewView({
  skills,
  timelineSourceSkills,
  range,
  onOpen,
  onSelectCategory,
  onColdStart,
}: {
  skills: NormalizedSkill[];
  timelineSourceSkills: NormalizedSkill[];
  range: TimeRange;
  onOpen: (skill: NormalizedSkill) => void;
  onSelectCategory: (category: SkillCategory) => void;
  onColdStart: () => void;
}) {
  const total = skills.reduce((sum, skill) => sum + callsForRange(skill, range), 0);
  const sorted = [...skills].sort((a, b) => callsForRange(b, range) - callsForRange(a, range) || b.callsTotal - a.callsTotal || a.name.localeCompare(b.name));
  const top = sorted[0];
  const todayCount = skills.reduce((sum, skill) => sum + callsForRange(skill, '今天'), 0);
  const never = skills.filter((skill) => callsForRange(skill, range) === 0).length;
  const timeline = aggregateTimelineFromTemplate(skills, timelineSourceSkills, range);
  const byCat = categoryStats(skills, range);
  return (
    <div className="view view--overview view-entrance">
      <ViewHero title="总览" subtitle={`${total} 次调用，覆盖 ${skills.length} 个 skill`} />
      <div className="stat-row">
        <StatCard label="总调用次数" value={total} sub={range === '全部' ? '历史累计' : range} color="#007AFF" />
        <StatCard label="今日调用" value={todayCount} sub="数据生成日" color="#34C759" />
        <StatCard label="最常用 skill" value={top ? top.name : '-'} sub={top ? `${callsForRange(top, range)} 次` : ''} color="#AF52DE" />
        <StatCard label="当前范围未用" value={never} sub="可考虑归档" color="#FF3B30" />
      </div>
      <div className="grid-2">
        <Card>
          <SectionHeader title={`${rangeLabel(range)}调用趋势`} hint="所有 skill 调用量按天聚合" />
          {timeline.length ? <TrendChart data={timeline} /> : <div className="coldstart__empty">当前范围暂无可按天展示的调用</div>}
          <TrendInsights timeline={timeline} range={range} />
        </Card>
        <Card>
          <SectionHeader title="按分类聚合" hint={`每个分类的${rangeLabel(range)}调用`} />
          <CategoryBars stats={byCat} onSelect={onSelectCategory} />
        </Card>
      </div>
      <div className="grid-2">
        <Card>
          <SectionHeader title={`Top ${RANKING_LIMIT} 排行`} hint="点击查看详情" action={<span className="section-head__action-text">by 调用次数</span>} />
          <RankingList skills={skills} range={range} onOpen={onOpen} />
        </Card>
        <Card>
          <SectionHeader
            title="冷启动发现"
            hint={`${rangeLabel(range)}未使用 / 低频使用`}
            action={<button className="section-head__action-link" type="button" onClick={onColdStart}>查看全部 ›</button>}
          />
          <ColdPreview skills={skills} range={range} onOpen={onOpen} onViewAll={onColdStart} />
        </Card>
      </div>
    </div>
  );
}

function CategoryView({ category, skills, range, onOpen }: { category: SkillCategory | 'all'; skills: NormalizedSkill[]; range: TimeRange; onOpen: (skill: NormalizedSkill) => void }) {
  const meta = category === 'all' ? null : CATEGORIES[category];
  const total = skills.reduce((sum, skill) => sum + callsForRange(skill, range), 0);
  const sorted = [...skills].sort((a, b) => callsForRange(b, range) - callsForRange(a, range) || b.callsTotal - a.callsTotal || a.name.localeCompare(b.name));
  const used = skills.filter((skill) => callsForRange(skill, range) > 0);
  const utilization = skills.length > 0 ? Math.round((used.length / skills.length) * 100) : 0;
  return (
    <div className="view view--category view-entrance">
      <ViewHero title={meta ? meta.label : '全部 Skills'} subtitle={`${skills.length} 个 skill · ${range} ${total} 次调用 · 利用率 ${utilization}%`} />
      <div className="stat-row">
        <StatCard label="本分类总数" value={skills.length} sub="已安装" color={meta?.color || '#007AFF'} />
        <StatCard label={`${range}调用`} value={total} sub="累计" color={meta?.color || '#007AFF'} />
        <StatCard label="利用率" value={`${utilization}%`} sub={`${used.length} / ${skills.length}`} color={utilization >= 70 ? '#34C759' : '#FF9500'} />
        <StatCard label="未使用" value={skills.length - used.length} sub="建议归档" color="#FF3B30" />
      </div>
      <Card>
        <SectionHeader title="本分类 skill 列表" hint="按调用次数降序" />
        <div className="skill-list">
          {sorted.length ? sorted.map((skill) => <SkillRow key={skill.name} skill={skill} range={range} onOpen={onOpen} />) : <EmptyState title="没有匹配项" subtitle="调整搜索、分类或时间范围后再看" />}
        </div>
      </Card>
    </div>
  );
}

function ColdStartView({
  skills,
  range,
  onOpen,
  onArchive,
  onDelete,
  onArchiveMany,
  onDeleteMany,
}: {
  skills: NormalizedSkill[];
  range: TimeRange;
  onOpen: (skill: NormalizedSkill) => void;
  onArchive: (name: string) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
  onArchiveMany: (names: string[]) => Promise<void>;
  onDeleteMany: (names: string[]) => Promise<void>;
}) {
  const [categoryFilter, setCategoryFilter] = useState<SkillCategory | 'all'>('all');
  const [installFilter, setInstallFilter] = useState<InstallFilter>('installed');
  const [selected, setSelected] = useState(() => new Set<string>());
  const dragState = useRef({
    startName: '',
    startX: 0,
    startY: 0,
    startPageY: 0,
    lastClientY: 0,
    dragging: false,
  });
  const justDragged = useRef(false);

  const allCandidates = skills.filter((skill) => callsForRange(skill, range) <= COLD_START_CALL_THRESHOLD);
  const candidates = allCandidates
    .filter((skill) => categoryFilter === 'all' || skill.cat === categoryFilter)
    .filter((skill) => installFilter === 'all' || (installFilter === 'installed' ? skill.installed : !skill.installed))
    .sort((a, b) => {
      const calls = callsForRange(a, range) - callsForRange(b, range);
      if (calls !== 0) return calls;
      return (Date.parse(a.lastSeen || '') || 0) - (Date.parse(b.lastSeen || '') || 0);
    });
  const candidateNames = useMemo(() => new Set(candidates.map((skill) => skill.name)), [candidates]);
  const never = candidates.filter((skill) => callsForRange(skill, range) === 0).length;
  const low = candidates.length - never;
  const scopeLabel = installFilter === 'installed' ? '已安装' : installFilter === 'archived' ? '历史未安装' : '全部';

  useEffect(() => {
    setSelected((current) => {
      const next = new Set([...current].filter((name) => candidateNames.has(name)));
      return next.size === current.size ? current : next;
    });
  }, [candidateNames]);

  const categoryPillStats = useMemo(() => {
    const stats = Object.fromEntries([
      ['all', { count: 0, calls: 0, neverUsed: 0 }],
      ...CATEGORY_KEYS.map((key) => [key, { count: 0, calls: 0, neverUsed: 0 }]),
    ]) as Record<SkillCategory | 'all', { count: number; calls: number; neverUsed: number }>;
    const sourceScopedCandidates = allCandidates.filter((skill) => (
      installFilter === 'all' || (installFilter === 'installed' ? skill.installed : !skill.installed)
    ));
    sourceScopedCandidates.forEach((skill) => {
      const calls = callsForRange(skill, range);
      stats.all.count += 1;
      stats.all.calls += calls;
      stats[skill.cat].count += 1;
      stats[skill.cat].calls += calls;
      if (calls === 0) {
        stats.all.neverUsed += 1;
        stats[skill.cat].neverUsed += 1;
      }
    });
    return stats;
  }, [allCandidates, installFilter, range]);

  const installCounts = useMemo(() => ({
    all: allCandidates.length,
    installed: allCandidates.filter((skill) => skill.installed).length,
    archived: allCandidates.filter((skill) => !skill.installed).length,
  }), [allCandidates]);

  const findScrollContainer = () => {
    const list = document.querySelector('.coldstart-list');
    if (!list) return null;
    let container = list.parentElement;
    while (container && container !== document.body) {
      if (container.scrollHeight > container.clientHeight + 1) return container;
      container = container.parentElement;
    }
    return document.scrollingElement;
  };

  const addRowsWithinDragRange = () => {
    const state = dragState.current;
    if (!state.startName) return;
    const container = findScrollContainer();
    if (!container) return;
    const scrollTop = container.scrollTop;
    const cursorPageY = state.lastClientY + scrollTop;
    const yMin = Math.min(state.startPageY, cursorPageY);
    const yMax = Math.max(state.startPageY, cursorPageY);
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.coldstart-list .skill-row'));
    const startIndex = rows.findIndex((row) => row.dataset.skillName === state.startName);
    if (startIndex < 0) return;
    const movingDown = cursorPageY >= state.startPageY;
    const firstIndex = movingDown ? startIndex : 0;
    const lastIndex = movingDown ? rows.length - 1 : startIndex;
    const added = new Set<string>();
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const row = rows[index];
      const rect = row.getBoundingClientRect();
      const top = rect.top + scrollTop;
      const bottom = rect.bottom + scrollTop;
      if (bottom >= yMin && top <= yMax && row.dataset.skillName) added.add(row.dataset.skillName);
    }
    if (!added.size) return;
    setSelected((current) => {
      const next = new Set(current);
      added.forEach((name) => next.add(name));
      return next;
    });
  };

  const beginDragSelection = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('.skill-row');
    const startName = row?.dataset.skillName;
    if (!startName) return;
    event.preventDefault();
    const container = findScrollContainer();
    const scrollTop = container?.scrollTop || 0;
    dragState.current = {
      startName,
      startX: event.clientX,
      startY: event.clientY,
      startPageY: event.clientY + scrollTop,
      lastClientY: event.clientY,
      dragging: false,
    };
  };

  useEffect(() => {
    let rafId: number | null = null;
    let scrollIntent = 0;

    const tick = () => {
      rafId = null;
      if (scrollIntent !== 0) {
        const container = findScrollContainer();
        if (container) container.scrollTop += scrollIntent;
      }
      if (dragState.current.dragging) {
        addRowsWithinDragRange();
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const onMove = (event: MouseEvent) => {
      const state = dragState.current;
      if (!state.startName) return;
      state.lastClientY = event.clientY;
      if (!state.dragging && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > DRAG_START_THRESHOLD_PX) {
        state.dragging = true;
      }
      if (!state.dragging) return;
      addRowsWithinDragRange();
      const container = findScrollContainer();
      if (container) {
        const rect = container.getBoundingClientRect();
        const topBound = rect.top + DRAG_SCROLL_EDGE_PX;
        const bottomBound = rect.bottom - DRAG_SCROLL_EDGE_PX;
        if (event.clientY < topBound) {
          scrollIntent = -Math.min(DRAG_SCROLL_MAX_STEP_PX, Math.max(1, Math.ceil(((topBound - event.clientY) / DRAG_SCROLL_EDGE_PX) * DRAG_SCROLL_MAX_STEP_PX)));
        } else if (event.clientY > bottomBound) {
          scrollIntent = Math.min(DRAG_SCROLL_MAX_STEP_PX, Math.max(1, Math.ceil(((event.clientY - bottomBound) / DRAG_SCROLL_EDGE_PX) * DRAG_SCROLL_MAX_STEP_PX)));
        } else {
          scrollIntent = 0;
        }
      }
      if (rafId === null) rafId = window.requestAnimationFrame(tick);
    };

    const onUp = () => {
      if (dragState.current.dragging) {
        justDragged.current = true;
        window.setTimeout(() => {
          justDragged.current = false;
        }, 0);
      }
      dragState.current.startName = '';
      dragState.current.dragging = false;
      scrollIntent = 0;
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selected.size > 0) {
        event.preventDefault();
        setSelected(new Set());
        justDragged.current = false;
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (!dragState.current.startName) return;
      dragState.current.lastClientY = event.clientY;
      dragState.current.dragging = true;
      addRowsWithinDragRange();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey);
    document.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('wheel', onWheel);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [selected.size, candidates]);

  const toggleSelection = (name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleRowClick = (skill: NormalizedSkill, event?: React.MouseEvent<HTMLDivElement>) => {
    if (event?.metaKey || event?.ctrlKey) {
      toggleSelection(skill.name);
      return;
    }
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }
    onOpen(skill);
  };

  const handleArchiveOne = async (skill: NormalizedSkill) => {
    const ok = await confirm(`把 ${skill.name} 从 SkiLens 列表中归档隐藏？不会删除磁盘文件。`, { title: '归档 skill' });
    if (!ok) return;
    await onArchive(skill.name);
    setSelected((current) => {
      const next = new Set(current);
      next.delete(skill.name);
      return next;
    });
  };

  const handleDeleteOne = async (skill: NormalizedSkill) => {
    if (!skill.sources.length) {
      window.alert('这个 skill 没有当前安装路径，不能从磁盘删除。');
      return;
    }
    const text = skill.sources.length > 1
      ? `将 ${skill.name} 的 ${skill.sources.length} 个安装副本移动到 ~/.Trash/skills-stats，并从 SkiLens 归档隐藏。继续？`
      : `将 ${skill.name} 移动到 ~/.Trash/skills-stats，并从 SkiLens 归档隐藏。继续？`;
    const ok = await confirm(text, { title: '删除 skill' });
    if (!ok) return;
    await onDelete(skill.name);
    setSelected((current) => {
      const next = new Set(current);
      next.delete(skill.name);
      return next;
    });
  };

  const selectedNames = [...selected].filter((name) => candidateNames.has(name));
  const handleBulkArchive = async () => {
    if (!selectedNames.length) return;
    const ok = await confirm(`归档 ${selectedNames.length} 个 skill？不会删除磁盘文件，列表中会隐藏。`, { title: '批量归档' });
    if (!ok) return;
    await onArchiveMany(selectedNames);
    setSelected(new Set());
  };

  const handleBulkDelete = async () => {
    if (!selectedNames.length) return;
    const selectedSkills = candidates.filter((skill) => selected.has(skill.name));
    const noSource = selectedSkills.filter((skill) => !skill.sources.length).length;
    const withSource = selectedSkills.length - noSource;
    const text = noSource > 0
      ? `将 ${selectedSkills.length} 个 skill 处理：\n${withSource} 个有磁盘源会移到 ~/.Trash/skills-stats 并归档，${noSource} 个无磁盘源会仅归档。继续？`
      : `将 ${selectedSkills.length} 个 skill 移动到 ~/.Trash/skills-stats，并归档隐藏。继续？`;
    const ok = await confirm(text, { title: '批量删除' });
    if (!ok) return;
    await onDeleteMany(selectedNames);
    setSelected(new Set());
  };

  return (
    <div className="view view--coldstart view-entrance">
      <ViewHero title="冷启动发现" subtitle={`${scopeLabel}中 ${never} 个当前范围未使用 + ${low} 个低频使用 = ${candidates.length} 个可复核 skill`} />
      <div className="coldstart-banner">
        <div className="coldstart-banner__title">这些 skill 在当前时间范围调用很少</div>
        <div className="coldstart-banner__sub">
          {installFilter === 'archived' ? '本机没有安装路径的 skill；只能归档隐藏，不能从磁盘删除。' : '从未使用的可以删除，低频的建议保留 1 个月观察。'}
        </div>
        <div className="coldstart-banner__hint">悬停行右侧可归档 / 删除，拖拽或 Cmd/Ctrl + 点击可多选</div>
      </div>
      <InstallSegmented value={installFilter} onChange={setInstallFilter} counts={installCounts} />
      <div className="cat-pill-row" style={{ marginBottom: 16 }}>
        <CategoryPill
          label="全部"
          icon="◎"
          color="#007AFF"
          stat={categoryPillStats.all}
          active={categoryFilter === 'all'}
          onClick={() => setCategoryFilter('all')}
        />
        {CATEGORY_KEYS.filter((key) => categoryPillStats[key].count > 0).map((key) => {
          const meta = CATEGORIES[key];
          return (
            <CategoryPill
              key={key}
              label={meta.label}
              icon={meta.icon}
              color={meta.color}
              stat={categoryPillStats[key]}
              active={categoryFilter === key}
              onClick={() => setCategoryFilter(key)}
            />
          );
        })}
      </div>
      <Card>
        {selectedNames.length > 0 && (
          <div className="coldstart-bulk">
            <span className="coldstart-bulk__count">已选 {selectedNames.length} 个</span>
            <span className="coldstart-bulk__hint">Cmd/Ctrl + 点击调整选择 · Esc 清除</span>
            <span className="coldstart-bulk__spacer" />
            <button className="coldstart-bulk__btn coldstart-bulk__btn--archive" type="button" onClick={handleBulkArchive}>
              <Archive size={14} /> 归档
            </button>
            <button className="coldstart-bulk__btn coldstart-bulk__btn--delete" type="button" onClick={handleBulkDelete}>
              <Trash2 size={14} /> 删除
            </button>
            <button className="coldstart-bulk__btn coldstart-bulk__btn--clear" type="button" onClick={() => setSelected(new Set())}>清空选择</button>
          </div>
        )}
        <div className="skill-list coldstart-list" onMouseDown={beginDragSelection}>
          {candidates.length ? candidates.map((skill) => (
            <SkillRow
              key={skill.name}
              skill={skill}
              range={range}
              onOpen={(clicked, event) => handleRowClick(clicked, event)}
              selected={selected.has(skill.name)}
              badge={skill.installed ? undefined : '历史未安装'}
              dim={!skill.installed}
              actions={[
                { label: '归档', icon: <Archive size={14} />, onClick: () => void handleArchiveOne(skill) },
                { label: '从磁盘删除', icon: <Trash2 size={14} />, danger: !skill.sources.length, onClick: () => void handleDeleteOne(skill) },
              ]}
            />
          )) : (
            <div className="coldstart__empty-state">
              <div className="coldstart__empty-icon" aria-hidden="true">✓</div>
              <div className="coldstart__empty-title">所有 skill 都在正常使用中</div>
              <div className="coldstart__empty-sub">当前范围和分类下没有需要清理的冷启动 skill</div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function rangeLabel(range: TimeRange) {
  if (range === '今天') return '今日';
  if (range === '全部') return '全时间';
  return range;
}

function daysScope(range: TimeRange) {
  if (range === '今天') return '今日中';
  if (range === '7天') return '7 天中';
  if (range === '全部') return '全时间中';
  return '30 天中';
}

function trendForRange(skill: NormalizedSkill, range: TimeRange): TrendDay[] {
  if (range === '今天') return skill.trend.slice(-1);
  if (range === '7天') return skill.trend.slice(-7);
  if (range === '全部') return skill.allTrend;
  return skill.trend;
}

function aggregateTimelineFromTemplate(skills: NormalizedSkill[], templateSkills: NormalizedSkill[], range: TimeRange): TrendDay[] {
  if (skills.length > 0) return aggregateTimeline(skills, range);
  const template = aggregateTimeline(templateSkills, range);
  return template.map((day) => ({ ...day, calls: 0 }));
}

function SkillDetail({
  skill,
  skills,
  range,
  onBack,
  onOpen,
  onArchive,
  onDelete,
}: {
  skill: NormalizedSkill;
  skills: NormalizedSkill[];
  range: TimeRange;
  onBack: () => void;
  onOpen: (skill: NormalizedSkill) => void;
  onArchive: (name: string) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
}) {
  const [showMd, setShowMd] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const md = useQuery({ queryKey: ['skill-md', skill.name], queryFn: () => readSkillMd(skill.name), enabled: showMd });
  const meta = CATEGORIES[skill.cat];
  const sourceCount = skill.sources.length;
  const trendForStats = trendForRange(skill, range);
  const rangeTotal = callsForRange(skill, range);
  const peakDay = trendForStats.reduce((max, day) => (day.calls > max.calls ? day : max), trendForStats[0] || { calls: 0, date: '', weekday: '', key: '' });
  const activeDays = trendForStats.filter((day) => day.calls > 0).length;
  const avgPerActive = activeDays > 0 ? (rangeTotal / activeDays).toFixed(1) : '0';
  const related = skills
    .filter((item) => item.cat === skill.cat && item.name !== skill.name)
    .sort((a, b) => callsForRange(b, range) - callsForRange(a, range) || b.callsTotal - a.callsTotal || a.name.localeCompare(b.name))
    .slice(0, 4);

  const handleArchive = async () => {
    const ok = await confirm(`把 ${skill.name} 从 SkiLens 列表中归档隐藏？不会删除磁盘文件。`, { title: '归档 skill' });
    if (!ok) return;
    setBusy(true);
    setMessage('');
    try {
      await onArchive(skill.name);
      onBack();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!sourceCount) {
      setMessage('这个 skill 没有当前安装路径，不能从磁盘删除。');
      return;
    }
    const text = sourceCount > 1
      ? `将 ${skill.name} 的 ${sourceCount} 个安装副本移动到 ~/.Trash/skills-stats，并从 SkiLens 归档隐藏。继续？`
      : `将 ${skill.name} 移动到 ~/.Trash/skills-stats，并从 SkiLens 归档隐藏。继续？`;
    const ok = await confirm(text, { title: '删除 skill' });
    if (!ok) return;
    setBusy(true);
    setMessage('');
    try {
      await onDelete(skill.name);
      onBack();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleReveal = async () => {
    if (!sourceCount) {
      setMessage('这个 skill 没有当前安装路径，不能在 Finder 中显示。');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await revealSkillMd(skill.name);
      setMessage('已在 Finder 中定位 SKILL.md。');
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view view--detail view-entrance">
      <div className="detail-head">
        <button className="back-btn" type="button" onClick={onBack}>
          <ChevronLeft size={14} />
          <span>返回</span>
        </button>
        <div className="detail-head__title">
          <div className="detail-head__name">{skill.name}</div>
          <div className="detail-head__meta">
            <span className="detail-pill" style={{ color: meta.color, background: `${meta.color}14` }}>{meta.icon} {meta.label}</span>
            <span className="detail-time">最后使用：{skill.lastUsed}</span>
          </div>
        </div>
      </div>

      <div className="detail-desc">{skill.desc}</div>

      <div className="stat-row">
        <StatCard label={`${rangeLabel(range)}调用`} value={rangeTotal} sub={range === '全部' ? '历史累计' : '当前范围'} color={meta.color} />
        <StatCard label="活跃天数" value={activeDays} sub={daysScope(range)} color="#34C759" />
        <StatCard label="日均" value={avgPerActive} sub="活跃日均" color="#007AFF" />
        <StatCard label="峰值" value={peakDay.calls} sub={peakDay.date ? `${peakDay.date} (周${peakDay.weekday})` : '-'} color="#AF52DE" />
      </div>
      <Card>
        <SectionHeader title={`${rangeLabel(range)}调用历史`} hint="按天" />
        {trendForStats.length ? <TrendChart data={range === '全部' ? trendForStats.slice(-30) : trendForStats} /> : <div className="coldstart__empty">当前范围暂无可按天展示的调用</div>}
      </Card>

      {related.length > 0 && (
        <Card>
          <SectionHeader title="同分类相关 skill" hint="按调用次数降序" />
          <div className="skill-list">
            {related.map((item) => (
              <SkillRow key={item.name} skill={item} range={range} onOpen={(next) => onOpen(next)} />
            ))}
          </div>
        </Card>
      )}

      <div className="detail-actions">
        <button className="detail-action detail-action--ghost" type="button" onClick={() => void handleArchive()} disabled={busy}>
          <Archive size={14} />
          <span>归档（移出列表）</span>
        </button>
        <button className="detail-action detail-action--ghost" type="button" onClick={() => void handleDelete()} disabled={busy || !sourceCount}>
          <Trash2 size={14} />
          <span>从磁盘删除</span>
        </button>
        <button className="detail-action detail-action--primary" type="button" onClick={() => setShowMd((value) => !value)} disabled={busy || !sourceCount}>
          <Info size={14} />
          <span>查看 SKILL.md</span>
        </button>
        <button className="detail-action detail-action--ghost" type="button" onClick={() => void handleReveal()} disabled={busy || !sourceCount}>
          <FolderOpen size={14} />
          <span>在 Finder 中显示</span>
        </button>
      </div>
      {message && <div className="detail-message">{message}</div>}
      {showMd && <SkillMdPanel data={md.data} loading={md.isLoading} error={md.error} onClose={() => setShowMd(false)} />}
      <Card>
        <SectionHeader title="最近证据" hint={`${skill.events.length} 条展示记录`} />
        <div className="event-list">
          {skill.events.slice(0, 12).map((event, index) => (
            <div className="event-row" key={`${event.signal}-${event.timestamp}-${index}`}>
              <span className="event-row__signal">{event.signal}</span>
              <span className="event-row__time">{event.timestamp || 'no timestamp'}</span>
              <span className="event-row__detail">{event.detail}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function SkillMdPanel({ data, loading, error, onClose }: { data?: SkillMdPayload; loading: boolean; error: unknown; onClose: () => void }) {
  if (loading) return <Card><EmptyState title="读取中" subtitle="正在读取 SKILL.md" /></Card>;
  if (error) return <Card><EmptyState title="读取失败" subtitle={String(error)} /></Card>;
  if (!data) return null;
  return (
    <div className="skill-md-panel">
      <div className="skill-md-panel__head">
        <div>
          <div className="skill-md-panel__title">SKILL.md</div>
          <div className="skill-md-panel__sub">{data.name}</div>
        </div>
        <button className="detail-action" type="button" onClick={onClose}>
          <X size={14} />
          <span>关闭</span>
        </button>
      </div>
      {data.files.map((file) => (
        <div className="skill-md-file" key={file.path}>
          <div className="skill-md-file__path">{file.path}</div>
          <pre className="skill-md-file__content">{file.content || file.error}</pre>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub: string; color: string }) {
  return (
    <div className="stat-card">
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value" style={{ color }}>{value}</div>
      <div className="stat-card__sub">{sub}</div>
    </div>
  );
}

function CategoryPill({
  label,
  icon,
  color,
  stat,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  color: string;
  stat: { count: number; calls: number; neverUsed: number };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`cat-pill ${active ? 'cat-pill--active' : ''}`}
      onClick={onClick}
      style={active ? { borderColor: color, background: `${color}14` } : undefined}
    >
      <div className="cat-pill__icon" style={{ color }}>{icon}</div>
      <div className="cat-pill__body">
        <div className="cat-pill__label">{label}</div>
        <div className="cat-pill__meta">
          {stat.count} skills · {stat.calls} calls
          {stat.neverUsed > 0 && <span className="cat-pill__warn">{stat.neverUsed} 未用</span>}
        </div>
      </div>
    </button>
  );
}

function InstallSegmented({ value, onChange, counts }: { value: InstallFilter; onChange: (value: InstallFilter) => void; counts: Record<InstallFilter, number> }) {
  const labels: Record<InstallFilter, string> = { all: '全部', installed: '已安装', archived: '历史未安装' };
  return (
    <div className="install-segmented">
      <span className="install-segmented__label">来源</span>
      <div className="install-segmented__group" role="tablist" aria-label="冷启动来源">
        {INSTALL_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={value === key}
            className={`install-segmented__btn ${value === key ? 'install-segmented__btn--active' : ''}`}
            onClick={() => onChange(key)}
          >
            <span>{labels[key]}</span>
            <span className="install-segmented__count">{counts[key]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

type SkillRowAction = {
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
};

function SkillRow({
  skill,
  range,
  onOpen,
  badge,
  dim = false,
  selected = false,
  actions,
}: {
  skill: NormalizedSkill;
  range: TimeRange;
  onOpen: (skill: NormalizedSkill, event?: React.MouseEvent<HTMLDivElement>) => void;
  badge?: string;
  dim?: boolean;
  selected?: boolean;
  actions?: SkillRowAction[];
}) {
  const meta = CATEGORIES[skill.cat];
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(skill);
    }
  };
  return (
    <div
      className={`skill-row ${selected ? 'skill-row--selected' : ''} ${dim ? 'skill-row--dim' : ''}`}
      role="button"
      tabIndex={0}
      data-skill-name={skill.name}
      onClick={(event) => onOpen(skill, event)}
      onKeyDown={handleKeyDown}
    >
      <span className="skill-row__dot" style={{ background: meta.color }} />
      <div className="skill-row__body">
        <div className="skill-row__name">{skill.name}</div>
        <div className="skill-row__desc">{skill.desc}</div>
      </div>
      <div className="skill-row__meta">
        {badge && <span className="skill-row__badge">{badge}</span>}
        <div className="skill-row__calls">
          <span className="skill-row__calls-num">{callsForRange(skill, range)}</span>
          <span className="skill-row__calls-unit">calls</span>
        </div>
        <div className="skill-row__time">{skill.lastUsed}</div>
      </div>
      {actions && actions.length > 0 && (
        <div className="skill-row__actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`skill-row__action ${action.danger ? 'skill-row__action--danger' : ''}`}
              title={action.label}
              aria-label={action.label}
              onClick={(event) => {
                event.stopPropagation();
                action.onClick();
              }}
            >
              {action.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RankingList({ skills, range, onOpen }: { skills: NormalizedSkill[]; range: TimeRange; onOpen: (skill: NormalizedSkill) => void }) {
  const top = [...skills]
    .filter((skill) => callsForRange(skill, range) > 0)
    .sort((a, b) => callsForRange(b, range) - callsForRange(a, range) || b.callsTotal - a.callsTotal || a.name.localeCompare(b.name))
    .slice(0, RANKING_LIMIT);
  const max = Math.max(...top.map((skill) => callsForRange(skill, range)), 1);
  if (!top.length) return <div className="coldstart__empty">当前范围暂无调用</div>;
  return (
    <div className="ranking">
      {top.map((skill, index) => {
        const meta = CATEGORIES[skill.cat];
        const calls = callsForRange(skill, range);
        return (
          <button key={skill.name} className="ranking__row" onClick={() => onOpen(skill)}>
            <span className="ranking__rank">{String(index + 1).padStart(2, '0')}</span>
            <span className="ranking__dot" style={{ background: meta.color }} />
            <span className="ranking__body">
              <span className="ranking__name">{skill.name}</span>
              <span className="ranking__bar"><span className="ranking__bar-fill" style={{ width: `${(calls / max) * 100}%`, background: meta.color }} /></span>
            </span>
            <span className="ranking__count"><span className="ranking__count-num">{calls}</span><span className="ranking__count-unit">次</span></span>
          </button>
        );
      })}
    </div>
  );
}

function CategoryBars({ stats, onSelect }: { stats: Record<SkillCategory, { count: number; calls: number; neverUsed: number }>; onSelect: (category: SkillCategory) => void }) {
  const max = Math.max(...Object.values(stats).map((stat) => stat.calls), 1);
  return (
    <div className="cat-bars">
      {CATEGORY_KEYS.map((key) => {
        const meta = CATEGORIES[key];
        const stat = stats[key];
        return (
          <button key={key} className="cat-bar" onClick={() => onSelect(key)}>
            <span className="cat-bar__head">
              <span className="cat-bar__icon" style={{ color: meta.color }}>{meta.icon}</span>
              <span className="cat-bar__label">{meta.label}</span>
              <span className="cat-bar__value">{stat.calls}</span>
              <span className="cat-bar__arrow">›</span>
            </span>
            <span className="cat-bar__track"><span className="cat-bar__fill" style={{ width: `${(stat.calls / max) * 100}%`, background: meta.color }} /></span>
          </button>
        );
      })}
    </div>
  );
}

function ColdPreview({
  skills,
  range,
  onOpen,
  onViewAll,
}: {
  skills: NormalizedSkill[];
  range: TimeRange;
  onOpen: (skill: NormalizedSkill) => void;
  onViewAll: () => void;
}) {
  const sorted = [...skills].sort((a, b) => callsForRange(a, range) - callsForRange(b, range) || a.name.localeCompare(b.name));
  const never = sorted.filter((skill) => callsForRange(skill, range) === 0);
  const low = sorted.filter((skill) => {
    const calls = callsForRange(skill, range);
    return calls > 0 && calls <= COLD_START_CALL_THRESHOLD;
  });
  const visibleNever = never.slice(0, COLD_START_PREVIEW_LIMIT);
  const visibleLow = low.slice(0, COLD_START_PREVIEW_LIMIT);
  return (
    <div className="coldstart">
      <div className="coldstart__group">
        <div className="coldstart__head">
          <span className="coldstart__title" style={{ color: '#FF3B30' }}>当前范围未使用 · {never.length}</span>
          <span className="coldstart__hint">历史低活跃项可优先复核</span>
        </div>
        {never.length === 0 ? <div className="coldstart__empty">当前范围暂无未使用 skill</div> : (
          <div className="coldstart__items">
            {visibleNever.map((skill) => {
              const meta = CATEGORIES[skill.cat];
              return (
                <button className="coldstart__item" key={skill.name} onClick={() => onOpen(skill)}>
                  <span className="coldstart__item-name">{skill.name}</span>
                  <span className="coldstart__item-cat" style={{ color: meta.color }}>{meta.label.split(' ')[0]}</span>
                </button>
              );
            })}
            {never.length > visibleNever.length && (
              <button className="coldstart__more" type="button" onClick={onViewAll}>
                还有 {never.length - visibleNever.length} 项，查看全部 ›
              </button>
            )}
          </div>
        )}
      </div>
      <div className="coldstart__group">
        <div className="coldstart__head">
          <span className="coldstart__title" style={{ color: '#FF9500' }}>低频使用 (≤{COLD_START_CALL_THRESHOLD}) · {low.length}</span>
          <span className="coldstart__hint">当前范围只调用过 1–{COLD_START_CALL_THRESHOLD} 次</span>
        </div>
        {low.length === 0 ? <div className="coldstart__empty">暂无低频使用 skill</div> : (
          <div className="coldstart__items">
            {visibleLow.map((skill) => {
              const meta = CATEGORIES[skill.cat];
              return (
                <button className="coldstart__item coldstart__item--low" key={skill.name} onClick={() => onOpen(skill)}>
                  <span className="coldstart__item-name">{skill.name}</span>
                  <span className="coldstart__item-calls">{callsForRange(skill, range)} 次</span>
                  <span className="coldstart__item-cat" style={{ color: meta.color }}>{meta.label.split(' ')[0]}</span>
                </button>
              );
            })}
            {low.length > visibleLow.length && (
              <button className="coldstart__more" type="button" onClick={onViewAll}>
                还有 {low.length - visibleLow.length} 项，查看全部 ›
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TrendInsights({ timeline, range }: { timeline: TrendDay[]; range: TimeRange }) {
  if (!timeline.length) return null;
  const total = timeline.reduce((sum, day) => sum + day.calls, 0);
  const days = timeline.length;
  const avg = days > 0 ? total / days : 0;
  const peak = timeline.reduce((best, day) => (day.calls > best.calls ? day : best), timeline[0]);
  const halfLen = Math.max(1, Math.floor(days / 2));
  const firstHalf = timeline.slice(0, halfLen);
  const secondHalf = timeline.slice(halfLen);
  const firstAvg = firstHalf.reduce((sum, day) => sum + day.calls, 0) / firstHalf.length;
  const secondAvg = secondHalf.length ? secondHalf.reduce((sum, day) => sum + day.calls, 0) / secondHalf.length : firstAvg;
  let trendLabel = '平稳';
  let trendColor = 'var(--text-2)';
  if (firstAvg > 0) {
    const change = (secondAvg - firstAvg) / firstAvg;
    if (change > 0.2) {
      trendLabel = '上升';
      trendColor = '#34C759';
    } else if (change < -0.2) {
      trendLabel = '下降';
      trendColor = '#FF3B30';
    }
  } else if (secondAvg > 0) {
    trendLabel = '上升';
    trendColor = '#34C759';
  }
  const activeDays = timeline.filter((day) => day.calls > 0).length;
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const weekdayCalls = [0, 0, 0, 0, 0, 0, 0];
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  timeline.forEach((day) => {
    const date = new Date(`${day.key}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return;
    const weekday = date.getUTCDay();
    weekdayCalls[weekday] += day.calls;
    weekdayCounts[weekday] += 1;
  });
  const weekdayAvg = weekdayCalls.map((calls, index) => (weekdayCounts[index] > 0 ? calls / weekdayCounts[index] : 0));
  const maxWeekdayAvg = Math.max(...weekdayAvg, 1);
  const summary = total === 0
    ? '当前范围没有调用记录。'
    : `${trendLabel === '上升' ? '调用量呈上升趋势' : trendLabel === '下降' ? '调用量有所下降' : '调用量整体平稳'}，共 ${total} 次调用${peak.calls > 0 ? `，高峰出现在 ${peak.date}` : ''}。`;
  const insights = [
    { label: '高峰日', value: peak.calls ? `${peak.date} · ${peak.calls} 次` : '-', color: '#007AFF' },
    { label: '日均', value: avg ? `${avg.toFixed(1)} 次` : '0 次', color: '#AF52DE' },
    { label: '趋势', value: trendLabel, color: trendColor },
    { label: '活跃天数', value: `${activeDays} / ${days} 天`, color: '#34C759' },
    { label: '总调用', value: `${total} 次`, color: '#FF3B30' },
    { label: '单日峰值', value: `${peak.calls} 次`, color: '#5856D6' },
  ];
  return (
    <div className="trend-insights-wrap">
      <div className="trend-insights__section">
        <div className="trend-insights__section-title">周活分布</div>
        <div className="trend-weekday">
          {weekdayNames.map((name, index) => (
            <div key={name} className="trend-weekday__col">
              <div className="trend-weekday__bar-wrap">
                <div className="trend-weekday__bar" style={{ height: `${(weekdayAvg[index] / maxWeekdayAvg) * 100}%` }} />
              </div>
              <div className="trend-weekday__label">{name}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="trend-insights">
        {insights.map((item) => (
          <div key={item.label} className="trend-insights__item">
            <div className="trend-insights__body">
              <span className="trend-insights__label">{item.label}</span>
              <span className="trend-insights__value" style={{ color: item.color }}>{item.value}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="trend-insights__summary">{rangeLabel(range)}：{summary}</div>
    </div>
  );
}

function TrendChart({ data }: { data: TrendDay[] }) {
  const W = 500;
  const H = 100;
  const pad = { l: 34, r: 14, t: 12, b: 24 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const max = Math.max(...data.map((day) => day.calls), 1);
  const points = data.map((day, index) => {
    const x = data.length === 1 ? pad.l + innerW / 2 : pad.l + (index / Math.max(data.length - 1, 1)) * innerW;
    const y = pad.t + innerH - (day.calls / max) * innerH;
    return { ...day, x, y };
  });
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
  const area = points.length ? `${path} L${points[points.length - 1].x},${pad.t + innerH} L${points[0].x},${pad.t + innerH} Z` : '';
  const barW = Math.max(2, Math.min(9, innerW / Math.max(data.length, 1) - 5));
  return (
    <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {[0, Math.ceil(max / 2), max].map((tick, index) => {
        const y = pad.t + innerH - (tick / max) * innerH;
        return <line key={`${tick}-${index}`} x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="var(--chart-grid)" strokeWidth="1" />;
      })}
      {points.map((point) => (
        <rect key={point.key} className="trend-chart__bar" x={point.x - barW / 2} y={point.y} width={barW} height={pad.t + innerH - point.y} rx="2" />
      ))}
      {points.length > 0 && <path className="trend-chart__area" d={area} fill="rgba(0,122,255,0.08)" />}
      {points.length > 0 && <path className="trend-chart__line" d={path} fill="none" stroke="#007AFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
      {points.filter((point) => point.calls > 0).slice(-8).map((point) => <circle key={`${point.key}-p`} className="trend-chart__point" cx={point.x} cy={point.y} r="3" />)}
    </svg>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>;
}

function ViewHero({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="view-hero">
      <div className="view-hero__title">{title}</div>
      <div className="view-hero__sub">{subtitle}</div>
    </div>
  );
}

function SectionHeader({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="section-head">
      <div className="section-head__title">{title}</div>
      {hint && <div className="section-head__hint">{hint}</div>}
      {action && <div className="section-head__action">{action}</div>}
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="coldstart__empty-state">
      <div className="coldstart__empty-title">{title}</div>
      <div className="coldstart__empty-sub">{subtitle}</div>
    </div>
  );
}

function PreferencesModal({
  preferences,
  archivedCount,
  onChange,
  onClose,
}: {
  preferences: Preferences;
  archivedCount: number;
  onChange: (patch: Partial<Preferences>) => void;
  onClose: () => void;
}) {
  const themeLabels: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };
  const dataRows = [
    { label: '偏好设置', value: 'localStorage: skilens.preferences.v1' },
    { label: 'SQLite', value: '~/Library/Application Support/skills-stats/skills-stats.db' },
    { label: '归档列表', value: 'archives table', hint: `${archivedCount} 个已归档` },
    { label: '页面数据', value: 'usage-data.js' },
    { label: '原始数据', value: 'skill-usage-data.json' },
  ];
  return (
    <div className="preferences-overlay modal-overlay-entrance" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="preferences-modal modal-entrance" role="dialog" aria-modal="true" aria-label="Preferences">
        <div className="preferences-head">
          <div>
            <div className="preferences-title">偏好设置</div>
            <div className="preferences-sub">SkiLens 本地偏好设置</div>
          </div>
          <button className="preferences-close" type="button" onClick={onClose} aria-label="关闭设置">×</button>
        </div>
        <div className="preferences-section">
          <div className="preferences-section__title">General</div>
          <div className="preferences-row">
            <div>
              <div className="preferences-row__label">默认时间范围</div>
              <div className="preferences-row__hint">打开应用后默认使用这个范围</div>
            </div>
            <div className="pref-seg">
              {TIME_RANGES.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`pref-seg__item ${preferences.defaultRange === item ? 'pref-seg__item--active' : ''}`}
                  onClick={() => onChange({ defaultRange: item })}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="preferences-row">
            <div>
              <div className="preferences-row__label">主题</div>
              <div className="preferences-row__hint">跟随系统或固定明暗模式</div>
            </div>
            <div className="pref-seg">
              {THEMES.map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={`pref-seg__item ${preferences.theme === theme ? 'pref-seg__item--active' : ''}`}
                  onClick={() => onChange({ theme })}
                >
                  {themeLabels[theme]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="preferences-section">
          <div className="preferences-section__title">Scanning</div>
          <div className="preferences-row">
            <div>
              <div className="preferences-row__label">触发模式</div>
              <div className="preferences-row__hint">当前迁移阶段保持手动重新扫描</div>
            </div>
            <div className="pref-static-pill">Manual</div>
          </div>
        </div>
        <div className="preferences-section">
          <div className="preferences-section__title">Data</div>
          <div className="preferences-data">
            {dataRows.map((row) => (
              <div className="preferences-data__row" key={row.label}>
                <span>{row.label}</span>
                <code>{row.value}</code>
                {row.hint && <em>{row.hint}</em>}
              </div>
            ))}
            <div className="preferences-data__row">
              <span>最近搜索</span>
              <code>{preferences.searchHistory.length} / {MAX_SEARCH_HISTORY_ITEMS}</code>
            </div>
          </div>
        </div>
        <div className="preferences-section preferences-section--last">
          <div className="preferences-section__title">About</div>
          <div className="preferences-about">
            <strong>SkiLens</strong>
            <span>mvp0.0.1 · Tauri 2 migration baseline</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScanNotice({ notice }: { notice: { type: 'info' | 'success' | 'error'; title: string; message?: string } }) {
  return (
    <div className={`scan-notice scan-notice--${notice.type}`} role="status" aria-live="polite">
      <div className="scan-notice__title">{notice.title}</div>
      {notice.message && <div className="scan-notice__message">{notice.message}</div>}
    </div>
  );
}

function MacWindow({ sidebar, children }: { width: number; height: number; sidebar: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mac-window" style={{ width: '100vw', height: '100vh', borderRadius: 26, overflow: 'hidden', background: 'var(--window-bg)', backdropFilter: 'blur(35px) saturate(180%)', WebkitBackdropFilter: 'blur(35px) saturate(180%)', border: '0.5px solid var(--border)', boxShadow: '0 0 0 1px rgba(0,0,0,0.1), 0 16px 48px rgba(0,0,0,0.22)', display: 'flex', position: 'relative', fontFamily: 'var(--font)' }}>
      <MacSidebar>{sidebar}</MacSidebar>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>{children}</div>
    </div>
  );
}

function MacSidebar({ children }: { children: React.ReactNode }) {
  return (
    <aside className="mac-sidebar" style={{ width: 220, height: '100%', padding: 0, flexShrink: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div
        className="mac-sidebar__content"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 0,
          background: 'var(--sidebar-bg)',
          backdropFilter: 'blur(32px) saturate(180%)',
          WebkitBackdropFilter: 'blur(32px) saturate(180%)',
          borderRight: '0.5px solid var(--border)',
          boxShadow: 'none',
        }}
      />
      <div style={{ position: 'relative', zIndex: 1, padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, height: '100%' }}>
        <div className="mac-sidebar__chrome" data-tauri-drag-region style={{ height: 32, display: 'flex', alignItems: 'center', padding: '0 10px', marginBottom: 4 }}>
          <div className="mac-sidebar__drag-region" data-tauri-drag-region />
        </div>
        {children}
      </div>
    </aside>
  );
}

function MacSidebarHeader({ title }: { title: string }) {
  return <div style={{ padding: '14px 18px 5px', fontSize: 11, fontWeight: 700, color: 'var(--text-3)' }}>{title}</div>;
}

function categoryStats(skills: NormalizedSkill[], range: TimeRange) {
  const stats = Object.fromEntries(CATEGORY_KEYS.map((key) => [key, { count: 0, calls: 0, neverUsed: 0 }])) as Record<SkillCategory, { count: number; calls: number; neverUsed: number }>;
  skills.forEach((skill) => {
    stats[skill.cat].count += 1;
    stats[skill.cat].calls += callsForRange(skill, range);
    if (skill.callsTotal === 0) stats[skill.cat].neverUsed += 1;
  });
  return stats;
}

function scanAgeLabel(timestamp?: string): string {
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

function emptyPayload() {
  return {
    generatedAt: '',
    totals: {},
    stats: {},
    skillRoots: [],
    logRoots: {},
    skills: [],
  };
}
