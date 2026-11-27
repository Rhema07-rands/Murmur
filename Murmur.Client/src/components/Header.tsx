import type { UserProfile, WorkerHealthResponse } from '../types/murmur';
import { LipsLogo, LogOutIcon, UserIcon } from './Icons';

interface HeaderProps {
  workerHealth: WorkerHealthResponse | null;
  onRefreshHealth: () => void;
  currentUser: UserProfile | null;
  onOpenAuth: () => void;
  onLogout: () => void;
}

export function Header({
  workerHealth,
  onRefreshHealth,
  currentUser,
  onOpenAuth,
  onLogout,
}: HeaderProps) {
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

      <div className="header-actions-group">
        {currentUser ? (
          <div className="user-badge-container">
            <span className="user-greeting">
              <UserIcon size={14} />
              <strong>{currentUser.username}</strong>
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onLogout}
              title="Sign out of this device"
            >
              <LogOutIcon size={13} />
              <span>Sign Out</span>
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenAuth}>
            <UserIcon size={14} />
            <span>Sign In / Sign Up</span>
          </button>
        )}

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
