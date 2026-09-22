import React, { useCallback } from 'react';
import { AppState, DebateCard } from '../types';
import CardList from './CardList';
import CardPreview from './CardPreview';

interface SplitPaneProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  showToast: (message: string) => void;
  onCardSelect?: (card: DebateCard) => void;
  searchStatus?: { loading: boolean; error?: string; total: number; page: number; totalPages: number; onPageChange: (page: number) => void };
}

const SplitPane: React.FC<SplitPaneProps> = ({ state, setState, showToast, onCardSelect, searchStatus }) => {
  const handleCardSelect = useCallback((card: DebateCard) => {
    if (onCardSelect) { onCardSelect(card); return; }
    setState(prev => ({ 
      ...prev, 
      selectedCardId: card.id,
      currentPreviewCard: card 
    }));
  }, [setState, onCardSelect]);

  const handleStepSelection = useCallback((direction: number) => {
    if (!state.filtered.length) return;
    
    const currentIdx = state.filtered.findIndex(c => c.id === state.selectedCardId);
    let nextIdx: number;
    
    if (currentIdx === -1) {
      nextIdx = 0;
    } else {
      nextIdx = Math.max(0, Math.min(state.filtered.length - 1, currentIdx + direction));
    }
    
    const nextCard = state.filtered[nextIdx];
    if (nextCard) {
      handleCardSelect(nextCard);
    }
  }, [state.filtered, state.selectedCardId, handleCardSelect]);

  return (
    <div className="split">
      <CardList
        cards={state.filtered}
        selectedCardId={state.selectedCardId}
        onCardSelect={handleCardSelect}
        search={state.search}
        sortOrder={state.sortOrder}
        docsCount={state.docs.size}
        loading={searchStatus?.loading}
        error={searchStatus?.error}
        total={searchStatus?.total}
        page={searchStatus?.page}
        totalPages={searchStatus?.totalPages}
        onPageChange={searchStatus?.onPageChange}
      />
      <CardPreview
        card={state.currentPreviewCard}
        docs={state.docs}
        onStepSelection={handleStepSelection}
        showToast={showToast}
      />
    </div>
  );
};

export default SplitPane;
