import type * as React from 'react';
import { CATEGORIES, callsForRange } from '../lib/data';
import type { NormalizedSkill, TimeRange } from '../types';

export type SkillRowAction = {
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
};

export function SkillRow({
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
