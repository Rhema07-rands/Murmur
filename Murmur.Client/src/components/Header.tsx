import type { WorkerHealthResponse } from '../types/murmur';

interface HeaderProps {
  workerHealth: WorkerHealthResponse | null;
  onRefreshHealth: () => void;
}

export function Header({ workerHealth, onRefreshHealth }: HeaderProps) {
  const isOnline = workerHealth?.available ?? false;

  return (
    <header className="murmur-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">M</span>
        <div>
          <h1>Murmur</h1>
          <p className="subtitle">Text-to-Speech &amp; PDF / EPUB Reader</p>
        </div>
      </div>

      <div className="status-group">
        <button
          type="button"
          className={`status-pill ${isOnline ? 'online' : 'offline'}`}
          onClick={onRefreshHealth}
          title={workerHealth?.error || 'Click to refresh local AI speech worker status'}
        >
          <span className="status-dot" />
          <span>
            {isOnline
              ? `AI Worker: ${workerHealth?.device.toUpperCase()}`
              : 'AI Worker: Offline (Browser TTS Ready)'}
          </span>
        </button>
      </div>
    </header>
  );
}
