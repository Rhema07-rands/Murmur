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
        <div className="brand-mark" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="28"
            height="28"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Stylized Lips Logo */}
            <path
              d="M2.5 12C3.8 9.2 6.5 7.5 9 8.2C10.5 8.6 11.4 10 12 10.3C12.6 10 13.5 8.6 15 8.2C17.5 7.5 20.2 9.2 21.5 12C19.8 12.8 17.5 13.2 15.2 12.6C13.5 12.2 12.6 11.2 12 11.2C11.4 11.2 10.5 12.2 8.8 12.6C6.5 13.2 4.2 12.8 2.5 12Z"
              fill="#ff4b72"
            />
            <path
              d="M3.2 12.8C5.2 16.8 8.2 18.5 12 18.5C15.8 18.5 18.8 16.8 20.8 12.8C17.8 14.8 14.8 14.5 12 14.5C9.2 14.5 6.2 14.8 3.2 12.8Z"
              fill="#e62e5c"
            />
          </svg>
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
