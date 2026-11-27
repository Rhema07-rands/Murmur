import type { WorkerHealthResponse } from '../types/murmur';
import { LipsLogo } from './Icons';

interface HeaderProps {
  workerHealth: WorkerHealthResponse | null;
  onRefreshHealth: () => void;
}

export function Header({ workerHealth, onRefreshHealth }: HeaderProps) {
  const isOnline = workerHealth?.available ?? false;

  return (
    <header className="murmur-header">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <LipsLogo size={36} />
        </div>
        <div>
          <h1>Murmur</h1>
          <p className="subtitle">Text-to-Speech &amp; PDF / EPUB / DOCX Reader</p>
        </div>
      </div>

      <div className="status-group">
        <button
          type="button"
          className={`status-pill ${isOnline ? 'online' : 'offline'}`}
          onClick={onRefreshHealth}
          title={workerHealth?.error || 'Click to refresh AI speech worker status'}
        >
          <span className="status-dot" />
          <span>
            {isOnline
              ? `AI Voices: ${workerHealth?.device}`
              : 'AI Voices: Offline (Browser TTS Ready)'}
          </span>
        </button>
      </div>
    </header>
  );
}
