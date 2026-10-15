import React, { useEffect, useRef, useState } from 'react';
import { AppState } from '../types';
import { getFilters } from '../api/cards';

interface SearchRowProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  searchInputRef?: React.RefObject<HTMLInputElement>;
  mode?: 'database' | 'local';
}

const SearchRow: React.FC<SearchRowProps> = ({ state, setState, searchInputRef, mode = 'local' }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [schools, setSchools] = useState<string[]>([]);
  const schoolFilterRef = useRef<HTMLDetailsElement>(null);
  const documents = Array.from(state.docs.values());
  const sections = [...new Set(state.cards.map(card => card.section).filter(Boolean))].sort();

  useEffect(() => {
    if (mode !== 'database') return;
    const controller = new AbortController();
    getFilters(controller.signal).then(filters => setSchools(filters.schools)).catch(error => {
      if (error.name !== 'AbortError') console.error('Could not load school filters:', error);
    });
    return () => controller.abort();
  }, [mode]);

  useEffect(() => {
    const dismissSchoolFilter = (event: PointerEvent) => {
      const filter = schoolFilterRef.current;
      if (filter?.open && !filter.contains(event.target as Node)) filter.open = false;
    };
    document.addEventListener('pointerdown', dismissSchoolFilter);
    return () => document.removeEventListener('pointerdown', dismissSchoolFilter);
  }, []);

  const toggleSchool = (school: string) => setState(previous => ({
    ...previous,
    schoolFilters: previous.schoolFilters.includes(school)
      ? previous.schoolFilters.filter(value => value !== school)
      : [...previous.schoolFilters, school],
  }));

  return <div className="search-row">
    <div className="search-wrap">
      <input ref={searchInputRef} type="search" value={state.search}
        onChange={event => setState(previous => ({
          ...previous,
          search: event.target.value,
          sortOrder: event.target.value.trim() && previous.sortOrder === 'newest' ? 'relevance' : previous.sortOrder,
        }))}
        placeholder='Search all cards: "exact phrase", word1 AND word2, word1 OR word2, -exclude' />
    </div>
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button className="search-help" style={{ position: 'static', transform: 'none' }} type="button" onClick={() => setShowTooltip(value => !value)}>?</button>
      {showTooltip && <div className="search-tooltip"><h4>Advanced Search</h4><ul>
        <li><code>"climate change"</code> — exact phrase</li>
        <li><code>climate AND policy</code> — both words</li>
        <li><code>climate OR warming</code> — either word</li>
        <li><code>climate -denial</code> — exclude a word</li>
      </ul></div>}
    </div>
    <div className="scope">
      {(['all', 'tag', 'cite', 'body'] as const).map(scope => <button key={scope}
        className={state.searchScope === scope ? 'active' : ''}
        onClick={() => setState(previous => ({ ...previous, searchScope: scope }))}>
        {scope.charAt(0).toUpperCase() + scope.slice(1)}
      </button>)}
    </div>

    {mode === 'database' ? <>
      <input className="author-filter" value={state.authorFilter}
        onChange={event => setState(previous => ({ ...previous, authorFilter: event.target.value }))} placeholder="Author" />
      <details ref={schoolFilterRef} className="multi-filter">
        <summary>{state.schoolFilters.length ? `${state.schoolFilters.length} school${state.schoolFilters.length === 1 ? '' : 's'}` : 'All schools'}</summary>
        <div className="multi-filter-menu">
          <div className="multi-filter-heading">
            <span>Select schools</span>
            {!!state.schoolFilters.length && <button type="button" onClick={() => setState(previous => ({ ...previous, schoolFilters: [] }))}>Clear</button>}
          </div>
          <div className="multi-filter-options">
            {schools.map(school => <label key={school}>
              <input type="checkbox" checked={state.schoolFilters.includes(school)} onChange={() => toggleSchool(school)} />
              <span>{school}</span>
            </label>)}
          </div>
        </div>
      </details>
      <select aria-label="Document side" value={state.sideFilter}
        onChange={event => setState(previous => ({ ...previous, sideFilter: event.target.value as AppState['sideFilter'] }))}>
        <option value="all">Aff &amp; Neg</option>
        <option value="aff">Aff documents</option>
        <option value="neg">Neg documents</option>
      </select>
    </> : <>
      <select value={state.docFilter} onChange={event => setState(previous => ({ ...previous, docFilter: event.target.value }))}>
        <option value="">All documents</option>
        {documents.map(doc => <option key={doc.id} value={doc.id}>{doc.shortName}</option>)}
      </select>
      <select value={state.sectionFilter} onChange={event => setState(previous => ({ ...previous, sectionFilter: event.target.value }))}>
        <option value="">All sections</option>
        {sections.map(section => <option key={section} value={section}>{section.substring(0, 50)}</option>)}
      </select>
    </>}

    <select value={state.sortOrder} onChange={event => setState(previous => ({ ...previous, sortOrder: event.target.value as AppState['sortOrder'] }))}>
      {mode === 'local' && <option value="doc">Document order</option>}
      {mode === 'local' && <option value="alpha">Author (A–Z)</option>}
      <option value="year-new">Year (newest first)</option>
      <option value="year-old">Year (oldest first)</option>
      {mode === 'local' && <option value="taglen">Tag length</option>}
      <option value="relevance">Relevance</option>
      {mode === 'database' && <option value="newest">Recently added</option>}
    </select>
  </div>;
};

export default SearchRow;
