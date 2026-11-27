import React, { useState } from 'react';
import { apiService } from '../services/apiService';
import type { UserProfile } from '../types/murmur';
import { UserIcon } from './Icons';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: UserProfile) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError('Please provide both username and password.');
      return;
    }

    setIsLoading(true);
    try {
      let authRes;
      if (mode === 'register') {
        authRes = await apiService.register(username.trim(), password);
      } else {
        authRes = await apiService.login(username.trim(), password);
      }

      localStorage.setItem('murmur_auth_token', authRes.token);
      localStorage.setItem('murmur_user_id', authRes.userId);
      localStorage.setItem('murmur_username', authRes.username);

      onSuccess({
        id: authRes.userId,
        username: authRes.username,
        createdAtUtc: new Date().toISOString(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UserIcon size={18} />
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>
              {mode === 'login' ? 'Sign In to Murmur' : 'Create a Murmur Account'}
            </h2>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            &times;
          </button>
        </div>

        <p className="text-muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Sync your saved documents, light novels, and reading progress across all your phones, tablets, and computers.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field">
            <label htmlFor="auth-username">Username</label>
            <input
              id="auth-username"
              type="text"
              className="library-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. shadowreader"
              autoComplete="username"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              className="library-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={isLoading} style={{ width: '100%' }}>
            {isLoading
              ? mode === 'login'
                ? 'Signing In...'
                : 'Creating Account...'
              : mode === 'login'
                ? 'Sign In'
                : 'Create Account'}
          </button>
        </form>

        <div className="auth-footer-toggle">
          {mode === 'login' ? (
            <span>
              Don't have an account?{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
              >
                Sign Up
              </button>
            </span>
          ) : (
            <span>
              Already have an account?{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
              >
                Sign In
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
