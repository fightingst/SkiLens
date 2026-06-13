import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  sub,
  color,
  onClick,
}: {
  label: string;
  value: number | string;
  sub: string;
  color: string;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <button className="stat-card stat-card--button" type="button" onClick={onClick}>
        <span className="stat-card__label">{label}</span>
        <span className="stat-card__value" style={{ color }}>{value}</span>
        <span className="stat-card__sub">{sub}</span>
      </button>
    );
  }
  return (
    <div className="stat-card">
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value" style={{ color }}>{value}</div>
      <div className="stat-card__sub">{sub}</div>
    </div>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="card">{children}</div>;
}

export function ViewHero({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="view-hero">
      <div className="view-hero__title">{title}</div>
      <div className="view-hero__sub">{subtitle}</div>
    </div>
  );
}

export function SectionHeader({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <div className="section-head__title">{title}</div>
      {hint && <div className="section-head__hint">{hint}</div>}
      {action && <div className="section-head__action">{action}</div>}
    </div>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="coldstart__empty-state">
      <div className="coldstart__empty-title">{title}</div>
      <div className="coldstart__empty-sub">{subtitle}</div>
    </div>
  );
}
