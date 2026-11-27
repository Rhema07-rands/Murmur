import { useRef, useState } from 'react';
import { apiService } from '../services/apiService';
import type { DocumentUploadResponse } from '../types/murmur';

interface DocumentUploaderProps {
  onLoadText: (text: string) => void;
}

export function DocumentUploader({ onLoadText }: DocumentUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<DocumentUploadResponse | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  const handleFile = async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.pdf') && !lower.endsWith('.epub') && !lower.endsWith('.docx')) {
      setError('Unsupported file type. Please choose a .pdf, .epub, or .docx file.');
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const result = await apiService.uploadDocument(file);
      setDoc(result);
      setSelectedIndices(new Set(result.sections.map((s) => s.index)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract document.');
    } finally {
      setUploading(false);
    }
  };

  const toggleSection = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleLoadSelected = () => {
    if (!doc) return;
    const combined = doc.sections
      .filter((s) => selectedIndices.has(s.index))
      .map((s) => s.content)
      .join('\n\n');
    if (!combined.trim()) {
      setError('Select at least one section to load.');
      return;
    }
    setError(null);
    onLoadText(combined);
  };

  const handleRemoveDoc = async () => {
    if (doc) {
      await apiService.deleteDocument(doc.id).catch(() => {});
    }
    setDoc(null);
    setSelectedIndices(new Set());
    setError(null);
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2>Document Reader (.PDF, .EPUB &amp; .DOCX)</h2>
        {doc && (
          <button type="button" className="btn btn-ghost" onClick={() => void handleRemoveDoc()}>
            Close Document
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.epub,.docx,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />

      {!doc ? (
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
        >
          <p>Drag &amp; drop a <strong>.pdf</strong>, <strong>.epub</strong>, or <strong>.docx</strong> file here, or</p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? 'Extracting text...' : 'Choose PDF, EPUB or DOCX'}
          </button>
          <span className="text-muted">Max file size: 50 MB</span>
        </div>
      ) : (
        <div className="doc-preview">
          <div className="doc-meta">
            <div>
              <strong>{doc.title}</strong>
              {doc.author && <span className="text-muted"> by {doc.author}</span>}
            </div>
            <span className="badge">
              {doc.fileType.toUpperCase()} · {doc.sectionCount} sections · {doc.totalCharacters.toLocaleString()} chars
            </span>
          </div>

          <div className="section-toolbar">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSelectedIndices(new Set(doc.sections.map((s) => s.index)))}
            >
              Select All
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setSelectedIndices(new Set())}
            >
              Deselect All
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleLoadSelected}
              disabled={selectedIndices.size === 0}
            >
              Load Selected ({selectedIndices.size}) into Editor
            </button>
          </div>

          <div className="section-list">
            {doc.sections.map((section) => (
              <label key={section.index} className="section-item">
                <input
                  type="checkbox"
                  checked={selectedIndices.has(section.index)}
                  onChange={() => toggleSection(section.index)}
                />
                <span className="section-title">{section.title}</span>
                <span className="text-muted">{section.characterCount.toLocaleString()} chars</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {error && <p className="error-banner">{error}</p>}
    </section>
  );
}
