import React, { useEffect, useLayoutEffect, useRef } from 'react';
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
  hasPrevious?: boolean;
  hasMore?: boolean;
  onLoadPrevious?: () => void;
  onLoadMore?: () => void;
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
  hasPrevious = false,
  hasMore = false,
  onLoadPrevious,
  onLoadMore,
}) => {
  const paneRef = useRef<HTMLDivElement>(null);
  const loadPreviousRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<{ cardId: string; top: number } | null>(null);

  const captureScrollAnchor = () => {
    const pane = paneRef.current;
    if (!pane) return;
    const paneTop = pane.getBoundingClientRect().top;
    const visibleCard = Array.from(pane.querySelectorAll<HTMLElement>('[data-card-id]'))
      .find(element => element.getBoundingClientRect().bottom > paneTop);
    if (visibleCard?.dataset.cardId) {
      scrollAnchorRef.current = { cardId: visibleCard.dataset.cardId, top: visibleCard.getBoundingClientRect().top };
    }
  };

  useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current;
    const pane = paneRef.current;
    if (!anchor || !pane) return;
    const anchoredCard = Array.from(pane.querySelectorAll<HTMLElement>('[data-card-id]'))
      .find(element => element.dataset.cardId === anchor.cardId);
    if (anchoredCard) pane.scrollTop += anchoredCard.getBoundingClientRect().top - anchor.top;
    scrollAnchorRef.current = null;
  }, [cards]);

  useEffect(() => {
    const target = loadPreviousRef.current;
    const pane = paneRef.current;
    if (!target || !pane || !hasPrevious || !onLoadPrevious || loading) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) return;
      captureScrollAnchor();
      onLoadPrevious();
    }, { root: pane, rootMargin: '300px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasPrevious, loading, onLoadPrevious]);

  useEffect(() => {
    const target = loadMoreRef.current;
    const pane = paneRef.current;
    if (!target || !pane || !hasMore || !onLoadMore || loading) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) return;
      captureScrollAnchor();
      onLoadMore();
    }, { root: pane, rootMargin: '300px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

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

  if (error && cards.length === 0) {
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
    <div className="left-pane" ref={paneRef}>
      <div className="pane-header">
        <div className="right">
          <button className="btn-link">Download all as ZIP</button>
        </div>
      </div>
      
      <div>
        {hasPrevious && <div ref={loadPreviousRef} className="infinite-scroll-status">
          {loading ? <><div className="spinner"></div>Loading earlier cards...</> : 'Scroll up for earlier cards'}
        </div>}
        {cards.map(card => {
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
              data-card-id={card.id}
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
        
        {onLoadMore && <div ref={loadMoreRef} className="infinite-scroll-status">
          {error ? `Could not load more cards: ${error}` : loading ? <><div className="spinner"></div>Loading more cards...</> : hasMore ? 'Scroll for more cards' : 'End of results'}
        </div>}
      </div>
    </div>
  );
};

export default CardList;
