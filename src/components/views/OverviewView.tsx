import { CATEGORY_KEYS, COLD_START_PREVIEW_LIMIT, RANKING_LIMIT } from '../../constants';
import { CATEGORIES, COLD_START_CALL_THRESHOLD, callsForRange } from '../../lib/data';
import { aggregateTimelineFromTemplate, categoryStats, rangeLabel } from '../../lib/viewHelpers';
import type { NormalizedSkill, SkillCategory, TimeRange } from '../../types';
import { TrendChart, TrendInsights } from '../Charts';
import { Card, SectionHeader, StatCard, ViewHero } from '../Common';

export function OverviewView({
  skills,
  timelineSourceSkills,
  range,
  onOpen,
  onSelectCategory,
  onColdStart,
  onOpenList,
}: {
  skills: NormalizedSkill[];
  timelineSourceSkills: NormalizedSkill[];
  range: TimeRange;
  onOpen: (skill: NormalizedSkill) => void;
  onSelectCategory: (category: SkillCategory) => void;
  onColdStart: () => void;
  onOpenList: (list: { title: string; subtitle: string; skills: NormalizedSkill[] }) => void;
}) {
  const total = skills.reduce((sum, skill) => sum + callsForRange(skill, range), 0);
  const sorted = [...skills].sort((a, b) => callsForRange(b, range) - callsForRange(a, range) || b.callsTotal - a.callsTotal || a.name.localeCompare(b.name));
  const top = sorted[0];
  const todayCount = skills.reduce((sum, skill) => sum + callsForRange(skill, '今天'), 0);
  const never = skills.filter((skill) => callsForRange(skill, range) === 0).length;
  const activeInRange = sorted.filter((skill) => callsForRange(skill, range) > 0);
  const activeToday = [...skills]
    .filter((skill) => callsForRange(skill, '今天') > 0)
    .sort((a, b) => callsForRange(b, '今天') - callsForRange(a, '今天') || a.name.localeCompare(b.name));
  const neverUsed = [...skills]
    .filter((skill) => callsForRange(skill, range) === 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const timeline = aggregateTimelineFromTemplate(skills, timelineSourceSkills, range);
  const byCat = categoryStats(skills, range);
  return (
    <div className="view view--overview view-entrance">
      <ViewHero title="总览" subtitle={`${total} 次调用，覆盖 ${skills.length} 个 skill`} />
      <div className="stat-row">
        <StatCard
          label="总调用次数"
          value={total}
          sub={range === '全部' ? '历史累计' : range}
          color="var(--accent)"
          onClick={() => onOpenList({ title: `${rangeLabel(range)}有调用的 Skills`, subtitle: `${activeInRange.length} 个 skill · ${total} 次调用`, skills: activeInRange })}
        />
        <StatCard
          label="今日调用"
          value={todayCount}
          sub="数据生成日"
          color="var(--color-success)"
          onClick={() => onOpenList({ title: '今日有调用的 Skills', subtitle: `${activeToday.length} 个 skill · ${todayCount} 次调用`, skills: activeToday })}
        />
        <StatCard
          label="最常用 skill"
          value={top ? top.name : '-'}
          sub={top ? `${callsForRange(top, range)} 次` : ''}
          color="var(--color-purple)"
          onClick={top ? () => onOpen(top) : undefined}
        />
        <StatCard
          label="当前范围未用"
          value={never}
          sub="可考虑归档"
          color="var(--color-danger)"
          onClick={() => onOpenList({ title: `${rangeLabel(range)}未使用的 Skills`, subtitle: `${neverUsed.length} 个 skill 当前范围没有调用`, skills: neverUsed })}
        />
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
          <span className="coldstart__title" style={{ color: 'var(--color-danger)' }}>当前范围未使用 · {never.length}</span>
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
          <span className="coldstart__title" style={{ color: 'var(--color-warning)' }}>低频使用 (≤{COLD_START_CALL_THRESHOLD}) · {low.length}</span>
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
