import type { SpeechEngine } from '../types/murmur';

interface SpeechControlsProps {
  engine: SpeechEngine;
  isSpeaking: boolean;
  isPaused: boolean;
  isGenerating: boolean;
  browserProgress: { current: number; total: number } | null;
  onPlayBrowser: () => void;
  onPauseBrowser: () => void;
  onResumeBrowser: () => void;
  onStopBrowser: () => void;
  onGenerateAi: () => void;
}

export function SpeechControls({
  engine,
  isSpeaking,
  isPaused,
  isGenerating,
  browserProgress,
  onPlayBrowser,
  onPauseBrowser,
  onResumeBrowser,
  onStopBrowser,
  onGenerateAi,
}: SpeechControlsProps) {
  return (
    <section className="card controls-bar">
      {engine === 'browser' ? (
        <>
          <div className="button-row">
            {!isSpeaking ? (
              <button type="button" className="btn btn-primary" onClick={onPlayBrowser}>
                Play Speech
              </button>
            ) : isPaused ? (
              <button type="button" className="btn btn-primary" onClick={onResumeBrowser}>
                Resume
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={onPauseBrowser}>
                Pause
              </button>
            )}
            <button
              type="button"
              className="btn btn-danger"
              disabled={!isSpeaking && !isPaused}
              onClick={onStopBrowser}
            >
              Stop
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
          <button
            type="button"
            className="btn btn-primary"
            disabled={isGenerating}
            onClick={onGenerateAi}
          >
            {isGenerating ? 'Generating AI Speech (MP3)...' : 'Generate AI Speech (MP3)'}
          </button>
        </div>
      )}
    </section>
  );
}
