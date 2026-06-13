import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_SEARCH_HISTORY_ITEMS } from './constants';
import type { Preferences } from './constants';
import { archiveSkill, archiveSkills, deleteSkill, getArchives, getDashboardData, rescan } from './lib/api';
import { COLD_START_CALL_THRESHOLD, callsForRange, normalizeSkills } from './lib/data';
import { applyThemePreference, loadPreferences, readInitialRoute, sanitizePreferences, savePreferencesToStorage } from './lib/preferences';
import { emptyPayload, scanAgeLabel } from './lib/viewHelpers';
import type { NormalizedSkill, SkillCategory, TimeRange, ViewKey } from './types';
import { EmptyState } from './components/Common';
import { PreferencesModal } from './components/PreferencesModal';
import { ScanNotice, MacWindow } from './components/Shell';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { CategoryView } from './components/views/CategoryView';
import { ColdStartView } from './components/views/ColdStartView';
import { ListView } from './components/views/ListView';
import { OverviewView } from './components/views/OverviewView';
import { SkillDetail } from './components/views/SkillDetail';

type DrilldownList = {
  title: string;
  subtitle: string;
  skills: NormalizedSkill[];
};

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
  const [drilldown, setDrilldown] = useState<DrilldownList | null>(null);

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
    setDrilldown(null);
    setView(category === 'all' ? 'overview' : 'category');
  };

  const openSkill = (skill: NormalizedSkill) => {
    if (view !== 'detail') setPrevView(view);
    setActiveSkillName(skill.name);
    setView('detail');
  };

  const openDrilldown = (next: DrilldownList) => {
    setDrilldown(next);
    setView('list');
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
          onColdStart={() => {
            setDrilldown(null);
            setView('coldstart');
          }}
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
          <OverviewView
            skills={filteredSkills}
            timelineSourceSkills={visibleSkills}
            range={range}
            onOpen={openSkill}
            onSelectCategory={selectCategory}
            onColdStart={() => {
              setDrilldown(null);
              setView('coldstart');
            }}
            onOpenList={openDrilldown}
          />
        )}
        {!dashboard.isLoading && !dashboard.error && view === 'category' && (
          <CategoryView category={activeCategory} skills={filteredSkills} range={range} onOpen={openSkill} onOpenList={openDrilldown} />
        )}
        {!dashboard.isLoading && !dashboard.error && view === 'coldstart' && (
          <ColdStartView
            skills={searchedVisibleSkills}
            range={range}
            onOpen={openSkill}
            onOpenList={openDrilldown}
            onArchive={archiveFromList}
            onDelete={deleteFromList}
            onArchiveMany={archiveManyFromList}
            onDeleteMany={deleteManyFromList}
          />
        )}
        {!dashboard.isLoading && !dashboard.error && view === 'list' && drilldown && (
          <ListView title={drilldown.title} subtitle={drilldown.subtitle} skills={drilldown.skills} range={range} onOpen={openSkill} />
        )}
        {!dashboard.isLoading && !dashboard.error && view === 'list' && !drilldown && (
          <div className="view view-entrance">
            <EmptyState title="没有可展示的列表" subtitle="请从总览、分类或冷启动页点击一个统计数字。" />
          </div>
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
