import type { SpeechEngine, SpeechJobStatus } from '../types/murmur';
import {
  Forward10Icon,
  MiniPlayerIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  Rewind10Icon,
  StopIcon,
} from './Icons';

interface SpeechControlsProps {
  engine: SpeechEngine;
  isSpeaking: boolean;
  isPaused: boolean;
  isGenerating: boolean;
  generationProgress?: SpeechJobStatus | null;
  isPlayingAi: boolean;
  isAiPaused: boolean;
  hasAiAudio: boolean;
  voiceChangedSinceGeneration?: boolean;
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
  onCancelGeneration?: () => void;
  onOpenMiniPlayer?: () => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Finalizing...';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) {
    return `~${mins}m ${secs}s remaining`;
  }
  return `~${secs}s remaining`;
}

export function SpeechControls({
  engine,
  isSpeaking,
  isPaused,
  isGenerating,
  generationProgress,
  isPlayingAi,
  isAiPaused,
  hasAiAudio,
  voiceChangedSinceGeneration = false,
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
  onCancelGeneration,
  onOpenMiniPlayer,
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
          {isGenerating && generationProgress && (
            <div className="generation-progress-box" aria-live="polite">
              <div className="generation-progress-header">
                <span className="generation-status-title">
                  <span className="spinner-dot" />
                  Generating Neural Audio ({generationProgress.progressPercent}%)
                </span>
                <span className="generation-eta-badge">
                  ⏱ {formatEta(generationProgress.estimatedSecondsRemaining)}
                </span>
              </div>

              <div
                className="generation-track"
                role="progressbar"
                aria-valuenow={generationProgress.progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="generation-fill"
                  style={{ width: `${Math.max(4, generationProgress.progressPercent)}%` }}
                />
              </div>

              <div className="generation-details-row">
                <span className="generation-detail">
                  Chunk {generationProgress.currentChunk} of {generationProgress.totalChunks} • {generationProgress.processedCharacters.toLocaleString()} / {generationProgress.totalCharacters.toLocaleString()} chars
                </span>
                {onCancelGeneration && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-cancel-job"
                    onClick={onCancelGeneration}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}

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

            {hasAiAudio && !isGenerating && (
              <button
                type="button"
                className={`btn ${voiceChangedSinceGeneration ? 'btn-primary' : 'btn-secondary'}`}
                onClick={onPlayAi}
                title="Generate new audio with the currently selected voice and expressiveness"
              >
                <RefreshIcon />
                <span>{voiceChangedSinceGeneration ? 'Regenerate New Voice' : 'Regenerate'}</span>
              </button>
            )}

            {hasAiAudio && onOpenMiniPlayer && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onOpenMiniPlayer}
                title="Pop out floating mini-player with -10s, +10s, speed & progress bar"
              >
                <MiniPlayerIcon />
                <span>Mini Player</span>
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
