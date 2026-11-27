import { useCallback, useEffect, useState } from 'react';
import { apiService } from '../services/apiService';
import type { SavedDocumentSummary } from '../types/murmur';
import { FolderIcon, SaveIcon, TrashIcon } from './Icons';

interface SavedLibraryProps {
  currentText: string;
  suggestedTitle?: string;
  onLoadDocument: (content: string, title: string) => void;
}

const DEFAULT_FOLDERS = ['General', 'Books', 'Study', 'Work'];

export function SavedLibrary({
  currentText,
  suggestedTitle,
  onLoadDocument,
}: SavedLibraryProps) {
  const [documents, setDocuments] = useState<SavedDocumentSummary[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>('All');
  const [saveTitle, setSaveTitle] = useState('');
  const [saveFolder, setSaveFolder] = useState('General');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const refreshLibrary = useCallback(async (folderFilter?: string) => {
    setLoading(true);
    setError(null);
    try {
      const targetFolder = folderFilter ?? activeFolder;
      const [docs, folderList] = await Promise.all([
        apiService.listSavedDocuments(targetFolder === 'All' ? undefined : targetFolder),
        apiService.listFolders(),
      ]);
      setDocuments(docs);
      setFolders(folderList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load saved documents.');
    } finally {
      setLoading(false);
    }
  }, [activeFolder]);

  useEffect(() => {
    void refreshLibrary('All');
  }, [refreshLibrary]);

  useEffect(() => {
    if (suggestedTitle && !saveTitle) {
      setSaveTitle(suggestedTitle);
    }
  }, [suggestedTitle, saveTitle]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentText.trim()) {
      setError('Enter or upload some text before saving.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const titleToSave = saveTitle.trim() || suggestedTitle || `Note ${new Date().toLocaleDateString()}`;
      const folderToSave = saveFolder.trim() || 'General';
      await apiService.saveDocumentToLibrary({
        title: titleToSave,
        folderName: folderToSave,
        content: currentText,
        fileType: 'text',
      });
      setSaveTitle('');
      setSuccessMsg(`Saved "${titleToSave}" to folder "${folderToSave}".`);
      await refreshLibrary(activeFolder);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save document to cloud.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpen = async (doc: SavedDocumentSummary) => {
    setError(null);
    try {
      const detail = await apiService.getSavedDocument(doc.id);
      onLoadDocument(detail.content, detail.title);
      setSuccessMsg(`Loaded "${detail.title}" into editor.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open saved document.');
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await apiService.deleteSavedDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      await refreshLibrary(activeFolder);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete document.');
    }
  };

  const allFolderSuggestions = Array.from(new Set([...DEFAULT_FOLDERS, ...folders]));

  return (
    <section className="card library-card">
      <div className="card-header">
        <div className="library-title-row">
          <FolderIcon size={18} />
          <h2>Saved Cloud Folders</h2>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void refreshLibrary(activeFolder)}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <form className="save-doc-form" onSubmit={(e) => void handleSave(e)}>
        <input
          type="text"
          className="library-input"
          placeholder="Document title..."
          value={saveTitle}
          onChange={(e) => setSaveTitle(e.target.value)}
        />
        <input
          type="text"
          className="library-input folder-input"
          list="murmur-folder-list"
          placeholder="Folder name..."
          value={saveFolder}
          onChange={(e) => setSaveFolder(e.target.value)}
        />
        <datalist id="murmur-folder-list">
          {allFolderSuggestions.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving || !currentText.trim()}
        >
          <SaveIcon />
          <span>{saving ? 'Saving...' : 'Save to Folder'}</span>
        </button>
      </form>

      {successMsg && <p className="library-success">{successMsg}</p>}
      {error && <p className="error-banner">{error}</p>}

      <div className="folder-tabs" role="tablist" aria-label="Filter by folder">
        <button
          type="button"
          className={`folder-tab ${activeFolder === 'All' ? 'active' : ''}`}
          onClick={() => {
            setActiveFolder('All');
            void refreshLibrary('All');
          }}
        >
          All
        </button>
        {folders.map((folder) => (
          <button
            key={folder}
            type="button"
            className={`folder-tab ${activeFolder === folder ? 'active' : ''}`}
            onClick={() => {
              setActiveFolder(folder);
              void refreshLibrary(folder);
            }}
          >
            {folder}
          </button>
        ))}
      </div>

      {documents.length === 0 ? (
        <p className="text-muted" style={{ fontSize: '0.85rem' }}>
          {loading ? 'Loading saved documents...' : 'No saved documents in this folder yet.'}
        </p>
      ) : (
        <ul className="saved-doc-list">
          {documents.map((doc) => (
            <li key={doc.id} className="saved-doc-item">
              <div className="saved-doc-meta">
                <strong>{doc.title}</strong>
                <span className="text-muted">
                  <span className="folder-pill">{doc.folderName}</span> · {doc.characterCount.toLocaleString()} chars · {new Date(doc.updatedAtUtc).toLocaleDateString()}
                </span>
              </div>
              <div className="saved-doc-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void handleOpen(doc)}
                >
                  Open
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void handleDelete(doc.id)}
                  title="Delete saved document"
                  aria-label={`Delete ${doc.title}`}
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
