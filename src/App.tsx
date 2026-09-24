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
import { expandUploadFiles } from './utils/archiveProcessor';
import { SearchEngine } from './utils/searchEngine';
import { getAdminStatus, getCard, getFilters, materializeCard, searchCards, uploadArchive, type FilterResponse } from './api/cards';
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
  authorFilter: '',
  sortOrder: 'newest',
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
  const [mode, setMode] = useState<'database' | 'local'>('database');
  const [filters, setFilters] = useState<FilterResponse | null>(null);
  const [page, setPage] = useState(1);
  const [searchStatus, setSearchStatus] = useState({ loading: true, error: '', total: 0, totalPages: 1 });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);

  const showToast = useCallback((message: string) => {
    setToast({ show: true, message });
    setTimeout(() => setToast(prev => ({ ...prev, show: false })), 2200);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(state.search), 300);
    return () => window.clearTimeout(timer);
  }, [state.search]);

  useEffect(() => {
    const controller = new AbortController();
    getFilters(controller.signal).then(setFilters).catch(error => {
      if (error.name !== 'AbortError') setSearchStatus(previous => ({ ...previous, error: error.message }));
    });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    if (!import.meta.env.DEV || !user) { setIsAdmin(false); return; }
    let active = true;
    getAdminStatus().then(value => { if (active) setIsAdmin(value); }).catch(() => { if (active) setIsAdmin(false); });
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (mode !== 'database') return;
    setPage(1);
  }, [mode, debouncedSearch, state.searchScope, state.yearMin, state.yearMax, state.authorFilter, state.sortOrder]);

  useEffect(() => {
    if (mode !== 'database') return;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: '25', scope: state.searchScope });
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (state.yearMin) params.set('yearMin', state.yearMin);
    if (state.yearMax) params.set('yearMax', state.yearMax);
    if (state.authorFilter) params.set('author', state.authorFilter);
    const apiSort = ['relevance', 'year-new', 'year-old', 'newest'].includes(state.sortOrder) ? state.sortOrder : 'newest';
    params.set('sort', apiSort);

    setSearchStatus(previous => ({ ...previous, loading: true, error: '' }));
    searchCards(params, controller.signal).then(result => {
      const docs = new Map();
      const cards: DebateCard[] = [];
      for (const item of result.items) {
        const materialized = materializeCard(item);
        if (!materialized) continue;
        docs.set(materialized.doc.id, materialized.doc);
        cards.push(materialized.card);
      }
      setState(previous => ({ ...previous, docs, cards, filtered: cards, selectedCardId: null, currentPreviewCard: null }));
      setSearchStatus({ loading: false, error: '', total: result.total, totalPages: result.totalPages });
    }).catch(error => {
      if (error.name !== 'AbortError') setSearchStatus(previous => ({ ...previous, loading: false, error: error.message }));
    });
    return () => controller.abort();
  }, [mode, page, debouncedSearch, state.searchScope, state.yearMin, state.yearMax, state.authorFilter, state.sortOrder, refreshKey]);

  // Recompute filtered whenever relevant state changes
  useEffect(() => {
    if (mode !== 'local') return;
    const { filtered, dupCount: dc } = computeFiltered(state);
    setDupCount(dc);
    setState(prev => {
      // avoid infinite loop: only update if filtered actually changed
      if (prev.filtered === filtered) return prev;
      return { ...prev, filtered };
    });
  }, [mode, state.search, state.searchScope, state.docFilter, state.sectionFilter, state.sortOrder, state.yearMin, state.yearMax, state.dedupEnabled, state.cards]); // eslint-disable-line react-hooks/exhaustive-deps

  const ingestFiles = useCallback(async (files: File[]) => {
    if (mode === 'database') {
      setProgress({ show: true, label: 'Preparing upload...', percent: 0 });
      try {
        let uniqueCards = 0, duplicates = 0, failures = 0;
        for (const file of files) {
          const job = await uploadArchive(file, (percent, label) => setProgress({ show: true, percent, label }));
          uniqueCards += job.uniqueCards; duplicates += job.duplicateCards; failures += job.failedDocuments;
        }
        setRefreshKey(value => value + 1);
        showToast(`Added ${uniqueCards} cards; ${duplicates} duplicates${failures ? `; ${failures} documents failed` : ''}`);
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Archive upload failed');
      } finally {
        setProgress(previous => ({ ...previous, show: false }));
      }
      return;
    }
    setMode('local');
    setProgress({ show: true, label: 'Preparing uploads...', percent: 0 });

    const newDocs = mode === 'local' ? new Map(state.docs) : new Map();
    const newCards = mode === 'local' ? [...state.cards] : [];
    const uniqueCards = new Set(
      newCards.map(card => `${card.cite.toLowerCase().replace(/\s+/g, ' ').trim()}\0${card.bodyPlain.toLowerCase().replace(/\s+/g, ' ').trim()}`)
    );
    let processed = 0;
    let skippedDuplicates = 0;
    let failed = 0;

    let documents;
    try {
      documents = await expandUploadFiles(files, label => {
        setProgress({ show: true, label, percent: 0 });
      });
    } catch (err) {
      console.error('Failed to expand upload:', err);
      setProgress(prev => ({ ...prev, show: false }));
      showToast(err instanceof Error ? err.message : 'Could not open the uploaded archive');
      return;
    }

    if (!documents.length) {
      setProgress(prev => ({ ...prev, show: false }));
      showToast('No DOCX files were found in the upload');
      return;
    }

    for (const item of documents) {
      try {
        const doc = await processDocxFile(item.file, {
          sourcePath: item.sourcePath,
          collection: item.collection,
          school: item.school,
          teamName: item.teamName,
        });
        newDocs.set(doc.id, doc);
        for (const card of parseCardsFromDoc(doc)) {
          const identity = `${card.cite.toLowerCase().replace(/\s+/g, ' ').trim()}\0${card.bodyPlain.toLowerCase().replace(/\s+/g, ' ').trim()}`;
          if (uniqueCards.has(identity)) { skippedDuplicates++; continue; }
          uniqueCards.add(identity);
          newCards.push(card);
        }
        processed++;
        setProgress({ show: true, percent: (processed / documents.length) * 100, label: `Read ${processed} of ${documents.length}: ${item.sourcePath}` });
        await new Promise(r => setTimeout(r, 0));
      } catch (err) {
        failed++;
        console.warn(`Failed to ingest ${item.sourcePath}:`, err);
      }
    }

    setState(prev => ({ ...prev, docs: newDocs, cards: newCards, sortOrder: 'doc' }));
    setTimeout(() => setProgress(prev => ({ ...prev, show: false })), 300);
    showToast(`Imported ${processed} documents; ${skippedDuplicates} duplicate cards skipped${failed ? `; ${failed} failed` : ''}`);
  }, [mode, state.docs, state.cards, showToast]);

  const selectDatabaseCard = useCallback(async (card: DebateCard) => {
    setState(previous => ({ ...previous, selectedCardId: card.id, currentPreviewCard: card }));
    try {
      const detail = await getCard(card.id);
      const materialized = materializeCard(detail);
      if (!materialized) return;
      setState(previous => {
        const docs = new Map(previous.docs);
        docs.set(materialized.doc.id, materialized.doc);
        return { ...previous, docs, selectedCardId: materialized.card.id, currentPreviewCard: materialized.card };
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load card details');
    }
  }, [showToast]);

  const returnToLibrary = useCallback(() => {
    setMode('database');
    setPage(1);
    setState(previous => ({ ...previous, docs: new Map(), cards: [], filtered: [], selectedCardId: null, currentPreviewCard: null, sortOrder: 'newest' }));
  }, []);

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
        mode={mode}
        libraryStats={mode === 'database' ? { documents: filters?.documents ?? 0, cards: filters?.cards ?? 0, shown: searchStatus.total } : undefined}
        onReturnLibrary={returnToLibrary}
        isAdmin={import.meta.env.DEV && isAdmin}
      />
      <SearchRow state={state} setState={setState} searchInputRef={searchInputRef} mode={mode} />
      <YearFilterRow state={state} setState={setState} mode={mode} />
      <SplitPane
        state={state}
        setState={setState}
        showToast={showToast}
        onCardSelect={mode === 'database' ? selectDatabaseCard : undefined}
        searchStatus={mode === 'database' ? { ...searchStatus, page, onPageChange: setPage } : undefined}
      />
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
