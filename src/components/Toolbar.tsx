import { useState } from 'react';
import { TIME_RANGES } from '../lib/data';
import type { TimeRange } from '../types';

export function Toolbar({
  range,
  search,
  searchHistory,
  onRange,
  onSearch,
  onSearchCommit,
}: {
  range: TimeRange;
  search: string;
  searchHistory: string[];
  onRange: (range: TimeRange) => void;
  onSearch: (value: string) => void;
  onSearchCommit: (value: string) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const commit = (value = search) => onSearchCommit(value);
  return (
    <div className="custom-toolbar" data-tauri-drag-region>
      <div className="custom-toolbar__right">
        <div className="seg-control" role="group" aria-label="时间范围">
          {TIME_RANGES.map((item) => (
            <button key={item} className={`seg-control__item ${range === item ? 'seg-control__item--active' : ''}`} aria-pressed={range === item} onClick={() => onRange(item)}>
              {item}
            </button>
          ))}
        </div>
        <div className="search-combo">
          <label className="search-box" htmlFor="skill-search">
            <span>⌕</span>
            <input
              id="skill-search"
              name="skill-search"
              className="search-box__input"
              placeholder="搜索 skill"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              onFocus={() => setHistoryOpen(true)}
              onBlur={() => {
                commit();
                window.setTimeout(() => setHistoryOpen(false), 120);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commit(event.currentTarget.value);
                  setHistoryOpen(false);
                }
              }}
            />
          </label>
          {historyOpen && searchHistory.length > 0 && (
            <div className="search-history">
              {searchHistory.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="search-history__item"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSearch(item);
                    commit(item);
                    setHistoryOpen(false);
                  }}
                >
                  <span>◷</span>
                  <span>{item}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
