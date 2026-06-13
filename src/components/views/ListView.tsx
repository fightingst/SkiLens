import type { NormalizedSkill, TimeRange } from '../../types';
import { Card, EmptyState, SectionHeader, ViewHero } from '../Common';
import { SkillRow } from '../SkillRow';

export function ListView({
  title,
  subtitle,
  skills,
  range,
  onOpen,
}: {
  title: string;
  subtitle: string;
  skills: NormalizedSkill[];
  range: TimeRange;
  onOpen: (skill: NormalizedSkill) => void;
}) {
  return (
    <div className="view view--list view-entrance">
      <ViewHero title={title} subtitle={subtitle} />
      <Card>
        <SectionHeader title="Skill 列表" hint="点击任意 skill 查看详情" />
        <div className="skill-list">
          {skills.length ? (
            skills.map((skill) => <SkillRow key={skill.name} skill={skill} range={range} onOpen={onOpen} />)
          ) : (
            <EmptyState title="没有匹配项" subtitle="当前条件下没有可展示的 skill" />
          )}
        </div>
      </Card>
    </div>
  );
}
