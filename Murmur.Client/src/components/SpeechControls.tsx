import type { SpeechEngine } from '../types/murmur';
import { Forward10Icon, PauseIcon, PlayIcon, Rewind10Icon, StopIcon } from './Icons';

interface SpeechControlsProps {
  engine: SpeechEngine;
  isSpeaking: boolean;
  isPaused: boolean;
  isGenerating: boolean;
  isPlayingAi: boolean;
  isAiPaused: boolean;
  hasAiAudio: boolean;
  aiCurrentTime: number;
  aiDuration: number;
  speed: number;
  currentSubtitle: string;
  browserProgress: { current: number; total: number } | null;
  startCursorPos?: number;
  onPlayBrowser: () => void;
  onPauseBrowser: () => void;
  onResumeBrowser: () => void;
  onStopBrowser: () => void;
  onPlayAi: () => void;
  onPauseAi: () => void;
  onResumeAi: () => void;
  onStopAi: () => void;
  onSkipAi: (seconds: number) => void;
  onSeekAi: (time: number) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function SpeechControls({
  engine,
  isSpeaking,
  isPaused,
  isGenerating,
  isPlayingAi,
  isAiPaused,
  hasAiAudio,
  aiCurrentTime,
  aiDuration,
  speed,
  currentSubtitle,
  browserProgress,
  startCursorPos = 0,
  onPlayBrowser,
  onPauseBrowser,
  onResumeBrowser,
  onStopBrowser,
  onPlayAi,
  onPauseAi,
  onResumeAi,
  onStopAi,
  onSkipAi,
  onSeekAi,
}: SpeechControlsProps) {
  const effectiveElapsed = aiCurrentTime / speed;
  const effectiveTotal = aiDuration / speed;

  return (
    <section className="card controls-bar">
      {engine === 'browser' ? (
        <>
          <div className="button-row">
            {!isSpeaking ? (
              <button type="button" className="btn btn-primary" onClick={onPlayBrowser}>
                <PlayIcon />
                <span>{startCursorPos > 0 ? 'Play from Cursor' : 'Play Speech'}</span>
              </button>
            ) : isPaused ? (
              <button type="button" className="btn btn-primary" onClick={onResumeBrowser}>
                <PlayIcon />
                <span>Resume</span>
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={onPauseBrowser}>
                <PauseIcon />
                <span>Pause</span>
              </button>
            )}
            <button
              type="button"
              className="btn btn-danger"
              disabled={!isSpeaking && !isPaused}
              onClick={onStopBrowser}
            >
              <StopIcon />
              <span>Stop</span>
            </button>
          </div>
          {browserProgress && (
            <span className="text-muted">
              Speaking segment {browserProgress.current} of {browserProgress.total}
            </span>
          )}
        </>
      ) : (
        <>
          <div className="button-row">
            {!isPlayingAi && !isAiPaused ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={isGenerating}
                onClick={onPlayAi}
              >
                <PlayIcon />
                <span>
                  {isGenerating
                    ? 'Generating Audio...'
                    : startCursorPos > 0
                      ? 'Play from Cursor'
                      : 'Play Speech'}
                </span>
              </button>
            ) : isAiPaused ? (
              <button type="button" className="btn btn-primary" onClick={onResumeAi}>
                <PlayIcon />
                <span>Resume</span>
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={onPauseAi}>
                <PauseIcon />
                <span>Pause</span>
              </button>
            )}

            {(isPlayingAi || isAiPaused || hasAiAudio) && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onSkipAi(-10)}
                  title="Go back 10 seconds"
                >
                  <Rewind10Icon />
                  <span>-10s</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onSkipAi(10)}
                  title="Skip ahead 10 seconds"
                >
                  <span>+10s</span>
                  <Forward10Icon />
                </button>
              </>
            )}

            {(isPlayingAi || isAiPaused) && (
              <button type="button" className="btn btn-danger" onClick={onStopAi}>
                <StopIcon />
                <span>Stop</span>
              </button>
            )}
          </div>

          {hasAiAudio && (
            <div className="reading-progress">
              <input
                type="range"
                className="seek-bar"
                min={0}
                max={aiDuration || 1}
                step={0.1}
                value={Math.min(aiCurrentTime, aiDuration || 1)}
                onChange={(e) => onSeekAi(parseFloat(e.target.value))}
                aria-label="Seek reading position"
              />
              <div className="timer-row">
                <span className="time-display">
                  {formatTime(effectiveElapsed)} / {formatTime(effectiveTotal)}
                </span>
                <span className="text-muted">
                  {speed !== 1 ? `Total at ${speed}x` : 'Total duration'}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {currentSubtitle && (
        <div className="subtitle-box" aria-live="polite">
          <span className="subtitle-label">Reading now</span>
          <p className="subtitle-text">{currentSubtitle}</p>
        </div>
      )}

      {startCursorPos > 0 && !isPlayingAi && !isAiPaused && !isSpeaking && (
        <span className="text-muted" style={{ fontSize: '0.8rem' }}>
          Starting playback from character {startCursorPos.toLocaleString()}
        </span>
      )}
    </section>
  );
}
