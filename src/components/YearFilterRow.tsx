import React, { useCallback, useMemo } from 'react';
import { AppState } from '../types';

interface YearFilterRowProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}

const YearFilterRow: React.FC<YearFilterRowProps> = ({ state, setState }) => {
  const years = useMemo(() => {
    return [...new Set(
      state.cards.map(c => c.year).filter(y => y !== null)
    )].sort((a, b) => a! - b!);
  }, [state.cards]);

  const handleYearMinChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setState(prev => ({ ...prev, yearMin: e.target.value }));
  }, [setState]);

  const handleYearMaxChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setState(prev => ({ ...prev, yearMax: e.target.value }));
  }, [setState]);

  const handleResetYears = useCallback(() => {
    setState(prev => ({ ...prev, yearMin: '', yearMax: '' }));
  }, [setState]);

  const handleDedupToggle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setState(prev => ({ ...prev, dedupEnabled: e.target.checked }));
  }, [setState]);

  const showResetButton = state.yearMin || state.yearMax;
  const withYear = state.cards.filter(c => c.year !== null).length;

  return (
    <div className="year-filter-row">
      <span className="label">Year:</span>
      
      <select value={state.yearMin} onChange={handleYearMinChange}>
        <option value="">Any</option>
        {years.map(year => (
          <option key={year} value={year!}>
            {year}
          </option>
        ))}
      </select>
      
      <span className="year-range-dash">–</span>
      
      <select value={state.yearMax} onChange={handleYearMaxChange}>
        <option value="">Any</option>
        {years.map(year => (
          <option key={year} value={year!}>
            {year}
          </option>
        ))}
      </select>
      
      {showResetButton && (
        <button className="reset-link" onClick={handleResetYears}>
          reset
        </button>
      )}
      
      <label className="dedup-toggle" title="Hide cards that share the same tag + citation as an earlier card">
        <input
          type="checkbox"
          checked={state.dedupEnabled}
          onChange={handleDedupToggle}
        />
        Hide duplicate cards
      </label>
      
      <span className="year-stats">
        {state.cards.length > 0 && `${withYear} of ${state.cards.length} cards have a year`}
      </span>
    </div>
  );
};

export default YearFilterRow;