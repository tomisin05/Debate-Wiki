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
  mode?: 'database' | 'local';
  onReturnLibrary?: () => void;
  isAdmin?: boolean;
}

const TopBar: React.FC<TopBarProps> = ({ state, setState, onIngestFiles, showToast, dupCount, onOpenMerge, mode = 'local', onReturnLibrary, isAdmin = false }) => {
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

      {isAdmin && <button className="upload-btn" onClick={() => fileInputRef.current?.click()}>
        + Add documents or ZIP
      </button>}

      {isAdmin && mode === 'local' && state.docs.size > 0 && (
        <button className="upload-btn secondary" onClick={handleClearAll}>Clear all</button>
      )}
      {isAdmin && mode === 'local' && onReturnLibrary && <button className="upload-btn secondary" onClick={onReturnLibrary}>Back to library</button>}

      {isAdmin && <button className="upload-btn secondary" onClick={onOpenMerge}>Merge Docs</button>}

      {isAdmin && <input ref={fileInputRef} type="file" className="file-input" accept=".docx,.zip" multiple onChange={handleFileChange} />}

      {mode === 'local' && <div className="stats-inline">
        <span className="stat-pill"><b>{dupCount}</b>duplicates hidden</span>
      </div>}

      <div className="user-menu">
        {user?.photoURL && <img src={user.photoURL} alt="User avatar" className="user-avatar" />}
        <span className="user-name">{user?.displayName || user?.email}</span>
        <button className="logout-btn" onClick={() => logout().catch(console.error)}>Sign out</button>
      </div>
    </div>
  );
};

export default TopBar;
