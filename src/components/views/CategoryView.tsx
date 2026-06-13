import { CATEGORIES, callsForRange } from '../../lib/data';
import type { NormalizedSkill, SkillCategory, TimeRange } from '../../types';
import { Card, EmptyState, SectionHeader, StatCard, ViewHero } from '../Common';
import { SkillRow } from '../SkillRow';

export function CategoryView({
  category,
  skills,
  range,
  onOpen,
  onOpenList,
}: {
  category: SkillCategory | 'all';
  skills: NormalizedSkill[];
  range: TimeRange;
  onOpen: (skill: NormalizedSkill) => void;
  onOpenList: (list: { title: string; subtitle: string; skills: NormalizedSkill[] }) => void;
}) {
  const meta = category === 'all' ? null : CATEGORIES[category];
  const total = skills.reduce((sum, skill) => sum + callsForRange(skill, range), 0);
  const sorted = [...skills].sort((a, b) => callsForRange(b, range) - callsForRange(a, range) || b.callsTotal - a.callsTotal || a.name.localeCompare(b.name));
  const used = skills.filter((skill) => callsForRange(skill, range) > 0);
  const unused = skills.filter((skill) => callsForRange(skill, range) === 0).sort((a, b) => a.name.localeCompare(b.name));
  const utilization = skills.length > 0 ? Math.round((used.length / skills.length) * 100) : 0;
  const title = meta ? meta.label : '全部 Skills';
  return (
    <div className="view view--category view-entrance">
      <ViewHero title={title} subtitle={`${skills.length} 个 skill · ${range} ${total} 次调用 · 利用率 ${utilization}%`} />
      <div className="stat-row">
        <StatCard
          label="本分类总数"
          value={skills.length}
          sub="已安装"
          color={meta?.color || 'var(--accent)'}
          onClick={() => onOpenList({ title: `${title} · 全部`, subtitle: `${sorted.length} 个 skill`, skills: sorted })}
        />
        <StatCard
          label={`${range}调用`}
          value={total}
          sub="累计"
          color={meta?.color || 'var(--accent)'}
          onClick={() => onOpenList({ title: `${title} · ${range}有调用`, subtitle: `${used.length} 个 skill · ${total} 次调用`, skills: used })}
        />
        <StatCard
          label="利用率"
          value={`${utilization}%`}
          sub={`${used.length} / ${skills.length}`}
          color={utilization >= 70 ? 'var(--color-success)' : 'var(--color-warning)'}
          onClick={() => onOpenList({ title: `${title} · 已使用`, subtitle: `${used.length} / ${skills.length} 个 skill 在当前范围有调用`, skills: used })}
        />
        <StatCard
          label="未使用"
          value={skills.length - used.length}
          sub="建议归档"
          color="var(--color-danger)"
          onClick={() => onOpenList({ title: `${title} · 未使用`, subtitle: `${unused.length} 个 skill 当前范围没有调用`, skills: unused })}
        />
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
