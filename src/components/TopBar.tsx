import React, { useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { AppState } from '../types';

interface TopBarProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onIngestFiles: (files: File[]) => void;
  showToast: (message: string) => void;
  dupCount: number;
  onOpenMerge: () => void;
}

const TopBar: React.FC<TopBarProps> = ({ state, setState, onIngestFiles, showToast, dupCount, onOpenMerge }) => {
  const { user, logout } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) { onIngestFiles(files); e.target.value = ''; }
  };

  const handleClearAll = () => {
    if (!window.confirm('Remove all uploaded documents?')) return;
    setState(prev => ({
      ...prev,
      docs: new Map(), cards: [], filtered: [],
      selectedCardId: null, currentPreviewBlob: null, currentPreviewCard: null,
      nextDocId: 1, nextCardId: 1, yearMin: '', yearMax: '',
    }));
    showToast('All documents cleared');
  };

  return (
    <div className="topbar">
      <h1>Debate Wiki <span className="accent">multi-doc</span></h1>

      <button className="upload-btn" onClick={() => fileInputRef.current?.click()}>
        + Add documents
      </button>

      {state.docs.size > 0 && (
        <button className="upload-btn secondary" onClick={handleClearAll}>Clear all</button>
      )}

      <button className="upload-btn secondary" onClick={onOpenMerge}>Merge Docs</button>

      <input ref={fileInputRef} type="file" className="file-input" accept=".docx" multiple onChange={handleFileChange} />

      <div className="stats-inline">
        <span className="stat-pill"><b>{state.docs.size}</b>documents</span>
        <span className="stat-pill"><b>{state.cards.length}</b>cards</span>
        <span className="stat-pill"><b>{dupCount}</b>duplicates hidden</span>
        <span className="stat-pill"><b>{state.filtered.length}</b>shown</span>
      </div>

      <div className="user-menu">
        {user?.photoURL && <img src={user.photoURL} alt="User avatar" className="user-avatar" />}
        <span className="user-name">{user?.displayName || user?.email}</span>
        <button className="logout-btn" onClick={() => logout().catch(console.error)}>Sign out</button>
      </div>
    </div>
  );
};

export default TopBar;
