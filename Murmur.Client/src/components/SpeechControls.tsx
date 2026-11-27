import type { SpeechEngine } from '../types/murmur';

interface SpeechControlsProps {
  engine: SpeechEngine;
  isSpeaking: boolean;
  isPaused: boolean;
  isGenerating: boolean;
  isPlayingAi: boolean;
  isAiPaused: boolean;
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
}

export function SpeechControls({
  engine,
  isSpeaking,
  isPaused,
  isGenerating,
  isPlayingAi,
  isAiPaused,
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
}: SpeechControlsProps) {
  return (
    <section className="card controls-bar">
      {engine === 'browser' ? (
        <>
          <div className="button-row">
            {!isSpeaking ? (
              <button type="button" className="btn btn-primary" onClick={onPlayBrowser}>
                ▶ Play Speech
              </button>
            ) : isPaused ? (
              <button type="button" className="btn btn-primary" onClick={onResumeBrowser}>
                ▶ Resume
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={onPauseBrowser}>
                ⏸ Pause
              </button>
            )}
            <button
              type="button"
              className="btn btn-danger"
              disabled={!isSpeaking && !isPaused}
              onClick={onStopBrowser}
            >
              ⏹ Stop
            </button>
          </div>
          {browserProgress && (
            <span className="text-muted">
              Speaking segment {browserProgress.current} of {browserProgress.total}
            </span>
          )}
        </>
      ) : (
        <div className="button-row">
          {!isPlayingAi && !isAiPaused ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={isGenerating}
              onClick={onPlayAi}
            >
              {isGenerating ? 'Generating Audio...' : startCursorPos > 0 ? '▶ Play from Cursor' : '▶ Play Speech'}
            </button>
          ) : isAiPaused ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onResumeAi}
            >
              ▶ Resume
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onPauseAi}
            >
              ⏸ Pause
            </button>
          )}

          {(isPlayingAi || isAiPaused) && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onSkipAi(10)}
              title="Skip ahead 10 seconds"
            >
              ⏩ +10s
            </button>
          )}

          {(isPlayingAi || isAiPaused) && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={onStopAi}
            >
              ⏹ Stop
            </button>
          )}
        </div>
      )}
      {startCursorPos > 0 && !isPlayingAi && !isAiPaused && (
        <span className="text-muted" style={{ fontSize: '0.8rem' }}>
          Starting playback from character {startCursorPos.toLocaleString()}
        </span>
      )}
    </section>
  );
}
