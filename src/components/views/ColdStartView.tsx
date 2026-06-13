import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { confirm, message } from '@tauri-apps/plugin-dialog';
import { Archive, Trash2 } from 'lucide-react';
import { CATEGORY_KEYS, DRAG_SCROLL_EDGE_PX, DRAG_SCROLL_MAX_STEP_PX, DRAG_START_THRESHOLD_PX, INSTALL_FILTERS } from '../../constants';
import type { InstallFilter } from '../../constants';
import { CATEGORIES, COLD_START_CALL_THRESHOLD, callsForRange } from '../../lib/data';
import type { NormalizedSkill, SkillCategory, TimeRange } from '../../types';
import { Card, StatCard, ViewHero } from '../Common';
import { SkillRow } from '../SkillRow';

export function ColdStartView({
  skills,
  range,
  onOpen,
  onOpenList,
  onArchive,
  onDelete,
  onArchiveMany,
  onDeleteMany,
}: {
  skills: NormalizedSkill[];
  range: TimeRange;
  onOpen: (skill: NormalizedSkill) => void;
  onOpenList: (list: { title: string; subtitle: string; skills: NormalizedSkill[] }) => void;
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
  const neverCandidates = candidates.filter((skill) => callsForRange(skill, range) === 0).sort((a, b) => a.name.localeCompare(b.name));
  const lowCandidates = candidates.filter((skill) => callsForRange(skill, range) > 0).sort((a, b) => callsForRange(a, range) - callsForRange(b, range) || a.name.localeCompare(b.name));

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

  const skillsForInstallFilter = (nextFilter: InstallFilter) => (
    allCandidates
      .filter((skill) => nextFilter === 'all' || (nextFilter === 'installed' ? skill.installed : !skill.installed))
      .sort((a, b) => callsForRange(a, range) - callsForRange(b, range) || a.name.localeCompare(b.name))
  );

  const skillsForCategory = (nextCategory: SkillCategory | 'all') => (
    allCandidates
      .filter((skill) => nextCategory === 'all' || skill.cat === nextCategory)
      .filter((skill) => installFilter === 'all' || (installFilter === 'installed' ? skill.installed : !skill.installed))
      .sort((a, b) => callsForRange(a, range) - callsForRange(b, range) || a.name.localeCompare(b.name))
  );

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
      await message('这个 skill 没有当前安装路径，不能从磁盘删除。', { title: '删除 skill', kind: 'warning' });
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
      <div className="stat-row">
        <StatCard
          label="当前筛选"
          value={candidates.length}
          sub={`${scopeLabel} · 可复核`}
          color="var(--accent)"
          onClick={() => onOpenList({ title: '冷启动发现 · 当前筛选', subtitle: `${candidates.length} 个可复核 skill`, skills: candidates })}
        />
        <StatCard
          label="未使用"
          value={never}
          sub="当前范围 0 次"
          color="var(--color-danger)"
          onClick={() => onOpenList({ title: '冷启动发现 · 未使用', subtitle: `${neverCandidates.length} 个 skill 当前范围没有调用`, skills: neverCandidates })}
        />
        <StatCard
          label="低频使用"
          value={low}
          sub={`1-${COLD_START_CALL_THRESHOLD} 次`}
          color="var(--color-warning)"
          onClick={() => onOpenList({ title: '冷启动发现 · 低频使用', subtitle: `${lowCandidates.length} 个 skill 当前范围低频调用`, skills: lowCandidates })}
        />
      </div>
      <div className="coldstart-banner">
        <div className="coldstart-banner__title">这些 skill 在当前时间范围调用很少</div>
        <div className="coldstart-banner__sub">
          {installFilter === 'archived' ? '本机没有安装路径的 skill；只能归档隐藏，不能从磁盘删除。' : '从未使用的可以删除，低频的建议保留 1 个月观察。'}
        </div>
        <div className="coldstart-banner__hint">悬停行右侧可归档 / 删除，拖拽或 Cmd/Ctrl + 点击可多选</div>
      </div>
      <InstallSegmented
        value={installFilter}
        onChange={setInstallFilter}
        counts={installCounts}
        onOpenList={(nextFilter) => {
          const list = skillsForInstallFilter(nextFilter);
          const label = nextFilter === 'installed' ? '已安装' : nextFilter === 'archived' ? '历史未安装' : '全部';
          onOpenList({ title: `冷启动发现 · ${label}`, subtitle: `${list.length} 个可复核 skill`, skills: list });
        }}
      />
      <div className="cat-pill-row" style={{ marginBottom: 16 }}>
        <CategoryPill
          label="全部"
          icon="◎"
          color="var(--accent)"
          activeBg="var(--accent-soft)"
          stat={categoryPillStats.all}
          active={categoryFilter === 'all'}
          onClick={() => setCategoryFilter('all')}
          onOpenList={() => {
            const list = skillsForCategory('all');
            onOpenList({ title: '冷启动发现 · 全部分类', subtitle: `${list.length} 个可复核 skill`, skills: list });
          }}
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
              onOpenList={() => {
                const list = skillsForCategory(key);
                onOpenList({ title: `冷启动发现 · ${meta.label}`, subtitle: `${list.length} 个可复核 skill`, skills: list });
              }}
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

function CategoryPill({
  label,
  icon,
  color,
  activeBg,
  stat,
  active,
  onClick,
  onOpenList,
}: {
  label: string;
  icon: string;
  color: string;
  activeBg?: string;
  stat: { count: number; calls: number; neverUsed: number };
  active: boolean;
  onClick: () => void;
  onOpenList: () => void;
}) {
  const style = {
    '--pill-color': color,
    '--pill-active-bg': activeBg || `${color}14`,
  } as CSSProperties;

  return (
    <button
      className={`cat-pill ${active ? 'cat-pill--active' : ''}`}
      onClick={onClick}
      style={style}
    >
      <div className="cat-pill__icon" style={{ color }}>{icon}</div>
      <div className="cat-pill__body">
        <div className="cat-pill__label">{label}</div>
        <div
          className="cat-pill__meta cat-pill__meta--link"
          onClick={(event) => {
            event.stopPropagation();
            onOpenList();
          }}
        >
          {stat.count} skills · {stat.calls} calls
          {stat.neverUsed > 0 && <span className="cat-pill__warn">{stat.neverUsed} 未用</span>}
        </div>
      </div>
    </button>
  );
}

function InstallSegmented({
  value,
  onChange,
  counts,
  onOpenList,
}: {
  value: InstallFilter;
  onChange: (value: InstallFilter) => void;
  counts: Record<InstallFilter, number>;
  onOpenList: (value: InstallFilter) => void;
}) {
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
            <span
              className="install-segmented__count install-segmented__count--link"
              onClick={(event) => {
                event.stopPropagation();
                onOpenList(key);
              }}
            >
              {counts[key]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
