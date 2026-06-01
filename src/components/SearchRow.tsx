import React, { useCallback, useState } from 'react';
import { AppState } from '../types';

interface SearchRowProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  searchInputRef?: React.RefObject<HTMLInputElement>;
}

const SearchRow: React.FC<SearchRowProps> = ({ state, setState, searchInputRef }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setState(prev => ({ ...prev, search: value }));
  }, [setState]);

  const handleScopeChange = useCallback((scope: 'all' | 'tag' | 'cite' | 'body') => {
    setState(prev => ({ ...prev, searchScope: scope }));
  }, [setState]);

  const handleDocFilterChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setState(prev => ({ ...prev, docFilter: e.target.value }));
  }, [setState]);

  const handleSectionFilterChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setState(prev => ({ ...prev, sectionFilter: e.target.value }));
  }, [setState]);

  const handleSortOrderChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setState(prev => ({ ...prev, sortOrder: e.target.value as AppState['sortOrder'] }));
  }, [setState]);

  // Get unique documents for filter
  const documents = Array.from(state.docs.values());
  
  // Get unique sections for filter
  const sections = [...new Set(state.cards.map(c => c.section).filter(Boolean))].sort();

  return (
    <div className="search-row">
      <div className="search-wrap">
        <input
          ref={searchInputRef}
          type="search"
          value={state.search}
          onChange={handleSearchChange}
          placeholder='Search: "exact phrase", word1 AND word2, word1 OR word2, -exclude, fuzzy~'
        />
      </div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <button className="search-help" style={{ position: 'static', transform: 'none' }} type="button" onClick={() => setShowTooltip(p => !p)}>?</button>
        {showTooltip && (
          <div className="search-tooltip">
            <h4>Advanced Search</h4>
            <ul>
              <li><code>"climate change"</code> - Exact phrase</li>
              <li><code>climate AND change</code> - Both words required</li>
              <li><code>climate OR warming</code> - Either word</li>
              <li><code>climate -denial</code> - Include climate, exclude denial</li>
              <li><code>climat~</code> - Fuzzy match (climate, climatic, etc.)</li>
              <li><code>"global warming" AND policy -skeptic</code> - Complex queries</li>
            </ul>
          </div>
        )}
      </div>
      
      <div className="scope">
        {(['all', 'tag', 'cite', 'body'] as const).map(scope => (
          <button
            key={scope}
            className={state.searchScope === scope ? 'active' : ''}
            onClick={() => handleScopeChange(scope)}
          >
            {scope.charAt(0).toUpperCase() + scope.slice(1)}
          </button>
        ))}
      </div>
      
      <select value={state.docFilter} onChange={handleDocFilterChange}>
        <option value="">All documents</option>
        {documents.map(doc => (
          <option key={doc.id} value={doc.id}>
            {doc.shortName}
          </option>
        ))}
      </select>
      
      <select value={state.sectionFilter} onChange={handleSectionFilterChange}>
        <option value="">All sections</option>
        {sections.map(section => (
          <option key={section} value={section}>
            {section.substring(0, 50)}
          </option>
        ))}
      </select>
      
      <select value={state.sortOrder} onChange={handleSortOrderChange}>
        <option value="doc">Document order</option>
        <option value="alpha">Author (A–Z)</option>
        <option value="year-new">Year (newest first)</option>
        <option value="year-old">Year (oldest first)</option>
        <option value="taglen">Tag length</option>
        <option value="relevance">Relevance</option>
      </select>
    </div>
  );
};

export default SearchRow;