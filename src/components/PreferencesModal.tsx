import { MAX_SEARCH_HISTORY_ITEMS, THEMES } from '../constants';
import type { Preferences, ThemePreference } from '../constants';
import { TIME_RANGES } from '../lib/data';

export function PreferencesModal({
  preferences,
  archivedCount,
  onChange,
  onClose,
}: {
  preferences: Preferences;
  archivedCount: number;
  onChange: (patch: Partial<Preferences>) => void;
  onClose: () => void;
}) {
  const themeLabels: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };
  const dataRows = [
    { label: '偏好设置', value: 'localStorage: skilens.preferences.v1' },
    { label: 'SQLite', value: '~/Library/Application Support/skills-stats/skills-stats.db' },
    { label: '归档列表', value: 'archives table', hint: `${archivedCount} 个已归档` },
    { label: '页面数据', value: 'usage-data.js' },
    { label: '原始数据', value: 'skill-usage-data.json' },
  ];
  return (
    <div className="preferences-overlay modal-overlay-entrance" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="preferences-modal modal-entrance" role="dialog" aria-modal="true" aria-label="Preferences">
        <div className="preferences-head">
          <div>
            <div className="preferences-title">偏好设置</div>
            <div className="preferences-sub">SkiLens 本地偏好设置</div>
          </div>
          <button className="preferences-close" type="button" onClick={onClose} aria-label="关闭设置">×</button>
        </div>
        <div className="preferences-section">
          <div className="preferences-section__title">General</div>
          <div className="preferences-row">
            <div>
              <div className="preferences-row__label">默认时间范围</div>
              <div className="preferences-row__hint">打开应用后默认使用这个范围</div>
            </div>
            <div className="pref-seg">
              {TIME_RANGES.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`pref-seg__item ${preferences.defaultRange === item ? 'pref-seg__item--active' : ''}`}
                  onClick={() => onChange({ defaultRange: item })}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="preferences-row">
            <div>
              <div className="preferences-row__label">主题</div>
              <div className="preferences-row__hint">跟随系统或固定明暗模式</div>
            </div>
            <div className="pref-seg">
              {THEMES.map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={`pref-seg__item ${preferences.theme === theme ? 'pref-seg__item--active' : ''}`}
                  onClick={() => onChange({ theme })}
                >
                  {themeLabels[theme]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="preferences-section">
          <div className="preferences-section__title">Scanning</div>
          <div className="preferences-row">
            <div>
              <div className="preferences-row__label">触发模式</div>
              <div className="preferences-row__hint">当前迁移阶段保持手动重新扫描</div>
            </div>
            <div className="pref-static-pill">Manual</div>
          </div>
        </div>
        <div className="preferences-section">
          <div className="preferences-section__title">Data</div>
          <div className="preferences-data">
            {dataRows.map((row) => (
              <div className="preferences-data__row" key={row.label}>
                <span>{row.label}</span>
                <code>{row.value}</code>
                {row.hint && <em>{row.hint}</em>}
              </div>
            ))}
            <div className="preferences-data__row">
              <span>最近搜索</span>
              <code>{preferences.searchHistory.length} / {MAX_SEARCH_HISTORY_ITEMS}</code>
            </div>
          </div>
        </div>
        <div className="preferences-section preferences-section--last">
          <div className="preferences-section__title">About</div>
          <div className="preferences-about">
            <strong>SkiLens</strong>
            <span>0.0.1</span>
          </div>
        </div>
      </div>
    </div>
  );
}
