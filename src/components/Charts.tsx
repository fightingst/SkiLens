import { rangeLabel } from '../lib/viewHelpers';
import type { TimeRange, TrendDay } from '../types';

export function TrendInsights({ timeline, range }: { timeline: TrendDay[]; range: TimeRange }) {
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
      trendColor = 'var(--color-success)';
    } else if (change < -0.2) {
      trendLabel = '下降';
      trendColor = 'var(--color-danger)';
    }
  } else if (secondAvg > 0) {
    trendLabel = '上升';
    trendColor = 'var(--color-success)';
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
    { label: '高峰日', value: peak.calls ? `${peak.date} · ${peak.calls} 次` : '-', color: 'var(--accent)' },
    { label: '日均', value: avg ? `${avg.toFixed(1)} 次` : '0 次', color: 'var(--color-purple)' },
    { label: '趋势', value: trendLabel, color: trendColor },
    { label: '活跃天数', value: `${activeDays} / ${days} 天`, color: 'var(--color-success)' },
    { label: '总调用', value: `${total} 次`, color: 'var(--color-danger)' },
    { label: '单日峰值', value: `${peak.calls} 次`, color: 'var(--color-indigo)' },
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

export function TrendChart({ data }: { data: TrendDay[] }) {
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
      {points.length > 0 && <path className="trend-chart__area" d={area} fill="rgba(var(--accent-rgb),0.08)" />}
      {points.length > 0 && <path className="trend-chart__line" d={path} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
      {points.filter((point) => point.calls > 0).slice(-8).map((point) => <circle key={`${point.key}-p`} className="trend-chart__point" cx={point.x} cy={point.y} r="3" />)}
    </svg>
  );
}
