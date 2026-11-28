import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiService } from '../services/apiService';
import type { NovelChapterDetail, NovelChapterSummary, NovelSummary } from '../types/murmur';
import {
  BookIcon,
  ChapterIcon,
  HeadphonesIcon,
  RefreshIcon,
  TrashIcon,
} from './Icons';

interface LightNovelReaderProps {
  onReadChapter: (chapterContent: string, chapterTitle: string, novelId: string, chapterIndex: number) => void;
  activeReadingNovelId?: string | null;
  activeReadingChapterIndex?: number | null;
  onAdvanceChapter?: (novelId: string, nextChapterIndex: number) => void;
}

export const LightNovelReader: React.FC<LightNovelReaderProps> = ({
  onReadChapter,
  activeReadingNovelId,
  activeReadingChapterIndex,
}) => {
  const [novels, setNovels] = useState<NovelSummary[]>([]);
  const [selectedNovel, setSelectedNovel] = useState<NovelSummary | null>(null);
  const [chapters, setChapters] = useState<NovelChapterSummary[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<NovelChapterDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [chapterSearchQuery, setChapterSearchQuery] = useState('');
  const [isLoadingNovels, setIsLoadingNovels] = useState(false);
  const [isLoadingChapters, setIsLoadingChapters] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<import('../types/murmur').NovelImportJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadNovels = useCallback(async () => {
    setIsLoadingNovels(true);
    setError(null);
    try {
      const data = await apiService.listNovels();
      setNovels(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load novel library.');
    } finally {
      setIsLoadingNovels(false);
    }
  }, []);

  useEffect(() => {
    void loadNovels();
  }, [loadNovels]);

  const handleSelectNovel = async (novel: NovelSummary) => {
    setSelectedNovel(novel);
    setSelectedChapter(null);
    setChapterSearchQuery('');
    setIsLoadingChapters(true);
    setError(null);
    try {
      const chs = await apiService.listNovelChapters(novel.id);
      setChapters(chs);
      // Auto-load last-read chapter or Chapter 1
      const targetIndex = novel.lastReadChapter > 0 ? novel.lastReadChapter : 1;
      const chDetail = await apiService.getNovelChapter(novel.id, targetIndex);
      setSelectedChapter(chDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chapters.');
    } finally {
      setIsLoadingChapters(false);
    }
  };

  const handleSelectChapter = async (chapterIndex: number) => {
    if (!selectedNovel) return;
    setIsLoadingContent(true);
    setError(null);
    try {
      const chDetail = await apiService.getNovelChapter(selectedNovel.id, chapterIndex);
      setSelectedChapter(chDetail);
      // Update progress in background
      void apiService.updateNovelProgress(selectedNovel.id, chapterIndex);
      setSelectedNovel((prev) => (prev ? { ...prev, lastReadChapter: chapterIndex } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chapter content.');
    } finally {
      setIsLoadingContent(false);
    }
  };

  const handleUploadEpub = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.epub')) {
      setError('Please select an EPUB (.epub) file.');
      return;
    }

    setIsUploading(true);
    setError(null);
    setUploadMessage('Uploading EPUB to cloud parser...');
    setUploadProgress(null);

    try {
      const res = await apiService.uploadNovelWithProgress(file, (status) => {
        setUploadProgress(status);
        if (status.stage === 'dissecting') {
          setUploadMessage(`Dissecting EPUB and reading chapter index... (${status.progressPercent}%)`);
        } else if (status.stage === 'saving') {
          setUploadMessage(
            `Saving chapters to TiDB Cloud: ${status.processedChapters} of ${status.totalChapters} (${status.progressPercent}%)`
          );
        } else if (status.stage === 'completed') {
          setUploadMessage(`Complete! Imported ${status.totalChapters} chapters.`);
        }
      });

      setUploadMessage(res.message);
      await loadNovels();
      if (res.id) {
        const updated = await apiService.getNovel(res.id);
        if (updated) {
          await handleSelectNovel(updated);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload and dissect EPUB.');
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteNovel = async (novelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this novel and all of its chapters from your library?')) return;

    try {
      await apiService.deleteNovel(novelId);
      if (selectedNovel?.id === novelId) {
        setSelectedNovel(null);
        setSelectedChapter(null);
        setChapters([]);
      }
      await loadNovels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete novel.');
    }
  };

  const filteredNovels = useMemo(() => {
    if (!searchQuery.trim()) return novels;
    const q = searchQuery.toLowerCase();
    return novels.filter(
      (n) => n.title.toLowerCase().includes(q) || (n.author && n.author.toLowerCase().includes(q))
    );
  }, [novels, searchQuery]);

  const filteredChapters = useMemo(() => {
    if (!chapterSearchQuery.trim()) return chapters;
    const q = chapterSearchQuery.toLowerCase();
    return chapters.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        `chapter ${c.chapterIndex}`.includes(q) ||
        String(c.chapterIndex).includes(q)
    );
  }, [chapters, chapterSearchQuery]);

  return (
    <div className="card novel-reader-card">
      <div className="card-header">
        <div className="novel-header-title">
          <BookIcon size={20} className="novel-brand-icon" />
          <div>
            <h2>Light Novels & EPUB Chapter Reader</h2>
            <p className="text-muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              Upload massive EPUBs (e.g. 2,000+ chapters). Each chapter is isolated so you never hit the character limit.
            </p>
          </div>
        </div>

        <div className="card-actions">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleUploadEpub}
            accept=".epub"
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? 'Importing EPUB...' : '+ Upload EPUB Novel'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void loadNovels()}
            title="Refresh novel list"
          >
            <RefreshIcon size={14} />
          </button>
        </div>
      </div>

      {uploadMessage && (
        <div className="library-success" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span>{uploadMessage}</span>
          {uploadProgress && (
            <div className="generation-track" style={{ height: '6px' }}>
              <div
                className="generation-fill"
                style={{ width: `${uploadProgress.progressPercent}%`, transition: 'width 0.3s ease' }}
              />
            </div>
          )}
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}

      {!selectedNovel ? (
        // Grid view of all novels
        <div className="novel-grid-section">
          <div className="novel-search-bar">
            <input
              type="text"
              className="library-input"
              placeholder="Search uploaded novels or authors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {isLoadingNovels ? (
            <p className="text-muted" style={{ padding: '16px', textAlign: 'center' }}>
              Loading your light novel library...
            </p>
          ) : filteredNovels.length === 0 ? (
            <div className="novel-empty-state">
              <BookIcon size={36} />
              <p>No light novels uploaded yet.</p>
              <span className="text-muted">
                Upload your EPUB files (like <em>Shadow's Sleep</em>) to have all chapters extracted and organized automatically.
              </span>
            </div>
          ) : (
            <div className="novel-shelf-grid">
              {filteredNovels.map((novel) => {
                const accentColor = novel.coverColor || '#6366f1';
                return (
                  <div
                    key={novel.id}
                    className="novel-card"
                    onClick={() => void handleSelectNovel(novel)}
                    style={{ borderTop: `4px solid ${accentColor}` }}
                  >
                    <div className="novel-card-content">
                      <strong className="novel-card-title" title={novel.title}>
                        {novel.title}
                      </strong>
                      {novel.author && (
                        <span className="novel-card-author text-muted">by {novel.author}</span>
                      )}
                      <div className="novel-card-badges">
                        <span className="badge">
                          <ChapterIcon size={12} /> {novel.totalChapters.toLocaleString()} chs
                        </span>
                        {novel.lastReadChapter > 0 && (
                          <span className="badge badge-accent">
                            Ch. {novel.lastReadChapter}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="novel-card-footer">
                      <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                        {(novel.totalCharacters / 1000).toFixed(0)}k chars
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={(e) => void handleDeleteNovel(novel.id, e)}
                        title="Delete novel"
                      >
                        <TrashIcon size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        // Split view: Chapter Browser & Reader
        <div className="novel-view-container">
          <div className="novel-view-toolbar">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSelectedNovel(null);
                setSelectedChapter(null);
              }}
            >
              &larr; Back to Shelf
            </button>
            <div className="novel-view-meta">
              <strong>{selectedNovel.title}</strong>
              <span className="text-muted">
                ({selectedNovel.totalChapters.toLocaleString()} chapters total)
              </span>
            </div>
          </div>

          <div className="novel-view-body">
            {/* Left Column: Chapter List */}
            <div className="novel-chapter-sidebar">
              <div className="novel-chapter-search">
                <input
                  type="text"
                  className="library-input"
                  placeholder="Filter chapters (e.g. 50 or title)..."
                  value={chapterSearchQuery}
                  onChange={(e) => setChapterSearchQuery(e.target.value)}
                  style={{ width: '100%', fontSize: '0.8rem' }}
                />
              </div>

              {isLoadingChapters ? (
                <p className="text-muted" style={{ padding: '12px' }}>Loading chapter index...</p>
              ) : (
                <div className="novel-chapter-scroll">
                  {filteredChapters.map((ch) => {
                    const isSelected = selectedChapter?.chapterIndex === ch.chapterIndex;
                    const isReadingThis =
                      activeReadingNovelId === selectedNovel.id &&
                      activeReadingChapterIndex === ch.chapterIndex;

                    return (
                      <div
                        key={ch.chapterIndex}
                        className={`novel-chapter-item ${isSelected ? 'active' : ''} ${isReadingThis ? 'reading' : ''}`}
                        onClick={() => void handleSelectChapter(ch.chapterIndex)}
                      >
                        <span className="novel-chapter-num">#{ch.chapterIndex}</span>
                        <span className="novel-chapter-title" title={ch.title}>
                          {ch.title}
                        </span>
                        {isReadingThis && (
                          <span className="reading-indicator" title="Currently reading aloud">
                            <HeadphonesIcon size={12} />
                          </span>
                        )}
                        <span className="novel-chapter-len text-muted">
                          {(ch.characterCount / 1000).toFixed(1)}k
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Column: Chapter Text & Read Action */}
            <div className="novel-reader-pane">
              {isLoadingContent ? (
                <p className="text-muted" style={{ padding: '24px', textAlign: 'center' }}>
                  Loading chapter text...
                </p>
              ) : selectedChapter ? (
                <>
                  <div className="novel-reader-header">
                    <div>
                      <h3 style={{ margin: '0 0 4px 0' }}>{selectedChapter.title}</h3>
                      <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                        Chapter {selectedChapter.chapterIndex} of {selectedChapter.totalChapters} &bull;{' '}
                        {selectedChapter.characterCount.toLocaleString()} characters
                      </span>
                    </div>

                    <div className="novel-reader-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() =>
                          onReadChapter(
                            selectedChapter.content,
                            `${selectedNovel.title} - ${selectedChapter.title}`,
                            selectedNovel.id,
                            selectedChapter.chapterIndex
                          )
                        }
                      >
                        <HeadphonesIcon size={16} />
                        Read Aloud With Murmur
                      </button>

                      {/* Chapter Navigation Buttons */}
                      <div className="button-row">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={selectedChapter.chapterIndex <= 1}
                          onClick={() => void handleSelectChapter(selectedChapter.chapterIndex - 1)}
                        >
                          &larr; Prev
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={selectedChapter.chapterIndex >= selectedChapter.totalChapters}
                          onClick={() => void handleSelectChapter(selectedChapter.chapterIndex + 1)}
                        >
                          Next &rarr;
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="novel-chapter-text-box">
                    <pre className="novel-text-content">{selectedChapter.content}</pre>
                  </div>
                </>
              ) : (
                <p className="text-muted" style={{ padding: '24px', textAlign: 'center' }}>
                  Select a chapter on the left to read.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
