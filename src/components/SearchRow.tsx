import React, { useState } from 'react';
import type { FilterResponse } from '../api/cards';
import { AppState } from '../types';

interface SearchRowProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  searchInputRef?: React.RefObject<HTMLInputElement>;
  mode?: 'database' | 'local';
  filters?: FilterResponse | null;
}

const SearchRow: React.FC<SearchRowProps> = ({ state, setState, searchInputRef, mode = 'local', filters }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const documents = Array.from(state.docs.values());
  const sections = [...new Set(state.cards.map(card => card.section).filter(Boolean))].sort();

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
      <select value={state.collectionFilter} onChange={event => setState(previous => ({ ...previous, collectionFilter: event.target.value }))}>
        <option value="">All collections</option>
        {filters?.collections.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <select value={state.schoolFilter} onChange={event => setState(previous => ({ ...previous, schoolFilter: event.target.value }))}>
        <option value="">All schools</option>
        {filters?.schools.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <select value={state.teamFilter} onChange={event => setState(previous => ({ ...previous, teamFilter: event.target.value }))}>
        <option value="">All teams</option>
        {filters?.teams.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <input className="author-filter" value={state.authorFilter}
        onChange={event => setState(previous => ({ ...previous, authorFilter: event.target.value }))} placeholder="Author" />
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
