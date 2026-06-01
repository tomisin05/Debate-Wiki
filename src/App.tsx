import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginScreen from './components/LoginScreen';
import TopBar from './components/TopBar';
import SearchRow from './components/SearchRow';
import YearFilterRow from './components/YearFilterRow';
import SplitPane from './components/SplitPane';
import ProgressOverlay from './components/ProgressOverlay';
import Toast from './components/Toast';
import MergePanel from './components/MergePanel';
import { AppState, DebateCard } from './types';
import { processDocxFile, parseCardsFromDoc } from './utils/docxProcessor';
import { SearchEngine } from './utils/searchEngine';
import './App.css';

const searchEngine = new SearchEngine();

const initialState: AppState = {
  docs: new Map(),
  cards: [],
  filtered: [],
  selectedCardId: null,
  search: '',
  searchScope: 'all',
  docFilter: '',
  sectionFilter: '',
  sortOrder: 'doc',
  yearMin: '',
  yearMax: '',
  dedupEnabled: true,
  nextDocId: 1,
  nextCardId: 1,
  currentPreviewBlob: null,
  currentPreviewCard: null,
};

function computeFiltered(state: AppState): { filtered: DebateCard[]; dupCount: number } {
  const { search, searchScope, docFilter, sectionFilter, sortOrder, yearMin, yearMax, dedupEnabled, cards } = state;
  const yearMinNum = yearMin ? Number(yearMin) : null;
  const yearMaxNum = yearMax ? Number(yearMax) : null;

  let result: DebateCard[] = [];
  for (const card of cards) {
    if (docFilter && card.docId !== docFilter) continue;
    if (sectionFilter && card.section !== sectionFilter) continue;
    if (card.year !== null) {
      if (yearMinNum !== null && card.year < yearMinNum) continue;
      if (yearMaxNum !== null && card.year > yearMaxNum) continue;
    }
    const sr = searchEngine.searchCard(card, search, searchScope);
    if (sr.matches) result.push({ ...card, searchScore: sr.score });
  }

  let dupCount = 0;
  if (dedupEnabled) {
    const seen = new Set<string>();
    const deduped: DebateCard[] = [];
    for (const card of result) {
      if (seen.has(card.dupKey)) { dupCount++; } else { seen.add(card.dupKey); deduped.push(card); }
    }
    result = deduped;
  }

  if (sortOrder === 'relevance' && search) {
    result.sort((a, b) => (b.searchScore || 0) - (a.searchScore || 0));
  } else if (sortOrder === 'alpha') {
    result.sort((a, b) => a.author.localeCompare(b.author));
  } else if (sortOrder === 'taglen') {
    result.sort((a, b) => a.tag.length - b.tag.length);
  } else if (sortOrder === 'year-new') {
    result.sort((a, b) => {
      if (a.year === null && b.year === null) return 0;
      if (a.year === null) return 1; if (b.year === null) return -1;
      return b.year - a.year;
    });
  } else if (sortOrder === 'year-old') {
    result.sort((a, b) => {
      if (a.year === null && b.year === null) return 0;
      if (a.year === null) return 1; if (b.year === null) return -1;
      return a.year - b.year;
    });
  }

  return { filtered: result, dupCount };
}

function AppContent() {
  const { user, loading } = useAuth();
  const [state, setState] = useState<AppState>(initialState);
  const [dupCount, setDupCount] = useState(0);
  const [progress, setProgress] = useState({ show: false, label: '', percent: 0 });
  const [toast, setToast] = useState({ show: false, message: '' });
  const [showMerge, setShowMerge] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((message: string) => {
    setToast({ show: true, message });
    setTimeout(() => setToast(prev => ({ ...prev, show: false })), 2200);
  }, []);

  // Recompute filtered whenever relevant state changes
  useEffect(() => {
    const { filtered, dupCount: dc } = computeFiltered(state);
    setDupCount(dc);
    setState(prev => {
      // avoid infinite loop: only update if filtered actually changed
      if (prev.filtered === filtered) return prev;
      return { ...prev, filtered };
    });
  }, [state.search, state.searchScope, state.docFilter, state.sectionFilter, state.sortOrder, state.yearMin, state.yearMax, state.dedupEnabled, state.cards]); // eslint-disable-line react-hooks/exhaustive-deps

  const ingestFiles = useCallback(async (files: File[]) => {
    setProgress({ show: true, label: `Reading ${files.length} document${files.length > 1 ? 's' : ''}...`, percent: 0 });

    const newDocs = new Map(state.docs);
    const newCards = [...state.cards];
    let processed = 0;

    for (const file of files) {
      try {
        const doc = await processDocxFile(file);
        newDocs.set(doc.id, doc);
        parseCardsFromDoc(doc).forEach(card => newCards.push(card));
        processed++;
        setProgress({ show: true, percent: (processed / files.length) * 100, label: `Read ${processed} of ${files.length}: ${file.name}` });
        await new Promise(r => setTimeout(r, 0));
      } catch (err) {
        console.warn(`Failed to ingest ${file.name}:`, err);
      }
    }

    setState(prev => ({ ...prev, docs: newDocs, cards: newCards }));
    setTimeout(() => setProgress(prev => ({ ...prev, show: false })), 300);
  }, [state.docs, state.cards]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input, textarea, select')) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setState(prev => {
          if (!prev.filtered.length) return prev;
          const idx = prev.filtered.findIndex(c => c.id === prev.selectedCardId);
          const next = prev.filtered[Math.min(prev.filtered.length - 1, idx === -1 ? 0 : idx + 1)];
          return { ...prev, selectedCardId: next.id, currentPreviewCard: next };
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setState(prev => {
          if (!prev.filtered.length) return prev;
          const idx = prev.filtered.findIndex(c => c.id === prev.selectedCardId);
          const next = prev.filtered[Math.max(0, idx === -1 ? 0 : idx - 1)];
          return { ...prev, selectedCardId: next.id, currentPreviewCard: next };
        });
      } else if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  if (loading) return <div className="loading-screen"><div className="spinner"></div><p>Loading...</p></div>;
  if (!user) return <LoginScreen />;

  return (
    <div className="app">
      <TopBar
        state={state}
        setState={setState}
        onIngestFiles={ingestFiles}
        showToast={showToast}
        dupCount={dupCount}
        onOpenMerge={() => setShowMerge(true)}
      />
      <SearchRow state={state} setState={setState} searchInputRef={searchInputRef} />
      <YearFilterRow state={state} setState={setState} />
      <SplitPane state={state} setState={setState} showToast={showToast} />
      <ProgressOverlay progress={progress} />
      <Toast toast={toast} />
      {showMerge && <MergePanel onClose={() => setShowMerge(false)} />}
    </div>
  );
}

function App() {
  return <AuthProvider><AppContent /></AuthProvider>;
}

export default App;
