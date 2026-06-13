import { CATEGORY_KEYS } from '../constants';
import { CATEGORIES, callsForRange } from '../lib/data';
import type { NormalizedSkill, SkillCategory, TimeRange, ViewKey } from '../types';
import { MacSidebarHeader } from './Shell';

export function Sidebar({
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
                <span className="sidebar-item__icon" style={{ color: item.key === 'coldstart' ? 'var(--color-warning)' : 'var(--accent)' }}>{item.icon}</span>
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
