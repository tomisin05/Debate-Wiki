import React from 'react';
import { DebateCard } from '../types';
import { escapeHtml } from '../utils/docxProcessor';

interface CardListProps {
  cards: DebateCard[];
  selectedCardId: string | null;
  onCardSelect: (card: DebateCard) => void;
  search: string;
  sortOrder: string;
  docsCount: number;
  loading?: boolean;
  error?: string;
  total?: number;
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
}

const CardList: React.FC<CardListProps> = ({ 
  cards, 
  selectedCardId, 
  onCardSelect, 
  search, 
  sortOrder, 
  docsCount,
  loading = false,
  error,
  total,
  page = 1,
  totalPages = 1,
  onPageChange,
}) => {
  const RENDER_CAP = 1000;
  const visible = cards.slice(0, RENDER_CAP);
  const overflow = cards.length - visible.length;

  const highlightMatches = (text: string, query: string): string => {
    if (!query.trim()) return text;
    const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(
      new RegExp(`(${safe})`, 'gi'), 
      '<mark style="background:var(--color-highlight-yellow);padding:0 1px;">$1</mark>'
    );
  };

  if (loading && cards.length === 0) {
    return <div className="left-pane"><div className="empty-msg"><div className="spinner"></div>Searching all cards...</div></div>;
  }

  if (error) {
    return <div className="left-pane"><div className="empty-msg">Could not load cards.<br />{error}</div></div>;
  }

  if (docsCount === 0 && total === undefined) {
    return (
      <div className="left-pane">
        <div className="pane-header">
        </div>
        <div className="empty-msg">
          Upload .docx files to get started.
        </div>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="left-pane">
        <div className="pane-header">
          <span>No cards match the current filters</span>
        </div>
        <div className="empty-msg">
          No cards match the current filters.
        </div>
      </div>
    );
  }

  return (
    <div className="left-pane">
      <div className="pane-header">
        <span>{cards.length} of {total ?? cards.length} cards{loading ? ' · updating...' : ''}</span>
        <div className="right">
          <button className="btn-link">Download all as ZIP</button>
        </div>
      </div>
      
      <div>
        {visible.map(card => {
          const tagHtml = search ? highlightMatches(escapeHtml(card.tag), search) : escapeHtml(card.tag);
          const citeHtml = search ? highlightMatches(escapeHtml(card.cite), search) : escapeHtml(card.cite);
          const snippetHtml = search ? highlightMatches(card.snippetHtml, search) : card.snippetHtml;
          const isActive = card.id === selectedCardId;
          const scoreHtml = card.searchScore && sortOrder === 'relevance' 
            ? `<span style="font-size:10px;color:var(--color-text-tertiary);margin-left:8px;">${Math.round(card.searchScore)}</span>` 
            : '';
          const yearBadge = card.year ? `<span class="year-badge">${card.year}</span>` : '';

          return (
            <div
              key={card.id}
              className={`card-item ${isActive ? 'active' : ''}`}
              onClick={() => onCardSelect(card)}
            >
              <div className="card-doc">
                <span className="doc-name" title={card.docName}>
                  {card.docName}
                </span>
                {card.section && (
                  <span>· {card.section.substring(0, 36)}</span>
                )}
                {scoreHtml && <span dangerouslySetInnerHTML={{ __html: scoreHtml }} />}
              </div>
              
              <div className="card-tag">
                <span dangerouslySetInnerHTML={{ __html: tagHtml }} />
                {yearBadge && <span dangerouslySetInnerHTML={{ __html: yearBadge }} />}
              </div>
              
              {card.cite && (
                <div className="card-cite">
                  <span dangerouslySetInnerHTML={{ __html: citeHtml }} />
                </div>
              )}
              
              {snippetHtml && (
                <div className="card-snippet">
                  <span dangerouslySetInnerHTML={{ __html: snippetHtml }} />
                </div>
              )}
            </div>
          );
        })}
        
        {overflow > 0 && (
          <div className="empty-msg" style={{ padding: '18px' }}>
            Showing first {RENDER_CAP} of {cards.length}. Narrow your search to see more.
          </div>
        )}
        {onPageChange && totalPages > 1 && (
          <div className="pagination">
            <button disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages || loading} onClick={() => onPageChange(page + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CardList;
