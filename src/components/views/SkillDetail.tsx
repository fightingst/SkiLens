import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { confirm } from '@tauri-apps/plugin-dialog';
import { Archive, ChevronLeft, FolderOpen, Info, Trash2, X } from 'lucide-react';
import { readSkillMd, revealSkillMd } from '../../lib/api';
import { CATEGORIES, callsForRange } from '../../lib/data';
import { daysScope, rangeLabel, trendForRange } from '../../lib/viewHelpers';
import type { NormalizedSkill, SkillMdPayload, TimeRange } from '../../types';
import { TrendChart } from '../Charts';
import { Card, EmptyState, SectionHeader, StatCard } from '../Common';
import { SkillRow } from '../SkillRow';

export function SkillDetail({
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
        <StatCard label="活跃天数" value={activeDays} sub={daysScope(range)} color="var(--color-success)" />
        <StatCard label="日均" value={avgPerActive} sub="活跃日均" color="var(--accent)" />
        <StatCard label="峰值" value={peakDay.calls} sub={peakDay.date ? `${peakDay.date} (周${peakDay.weekday})` : '-'} color="var(--color-purple)" />
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
