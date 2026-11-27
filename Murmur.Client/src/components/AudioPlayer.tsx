import { useEffect, useRef, useState } from 'react';
import type { SpeechGenerateResponse } from '../types/murmur';
import { DownloadIcon, Forward10Icon, PauseIcon, PlayIcon, Rewind10Icon, StopIcon } from './Icons';

interface AudioPlayerProps {
  generated: SpeechGenerateResponse | null;
  audioRefShared?: React.RefObject<HTMLAudioElement | null>;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function AudioPlayer({ generated, audioRefShared }: AudioPlayerProps) {
  const localRef = useRef<HTMLAudioElement>(null);
  const audioRef = audioRefShared || localRef;

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(generated?.durationSeconds ?? 0);
    setError(null);
    if (audioRef.current && generated) {
      audioRef.current.load();
      audioRef.current.playbackRate = playbackRate;
    }
  }, [generated]);

  if (!generated) {
    return null;
  }

  const togglePlay = async () => {
    const el = audioRef.current;
    if (!el) return;
    setError(null);
    try {
      if (playing) {
        el.pause();
      } else {
        await el.play();
      }
    } catch {
      setError('Could not play generated audio.');
    }
  };

  const stopAudio = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setPlaying(false);
  };

  const skipSeconds = (secs: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + secs));
  };

  return (
    <section className="card audio-player-card">
      <div className="card-header">
        <h2>Generated Audio (MP3)</h2>
        <a
          className="btn btn-primary"
          href={generated.downloadUrl}
          download={`murmur-${generated.audioId.slice(0, 8)}.mp3`}
        >
          <DownloadIcon />
          <span>Download MP3</span>
        </a>
      </div>

      <audio
        ref={audioRef}
        src={generated.audioUrl}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) {
            setDuration(e.currentTarget.duration);
          }
        }}
        onError={() => setError('Failed to load audio stream.')}
      />

      <div className="player-controls">
        <button type="button" className="btn btn-secondary" onClick={() => void togglePlay()}>
          {playing ? <PauseIcon /> : <PlayIcon />}
          <span>{playing ? 'Pause' : 'Play'}</span>
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => skipSeconds(-10)} title="Go back 10 seconds">
          <Rewind10Icon />
          <span>-10s</span>
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => skipSeconds(10)} title="Skip forward 10 seconds">
          <span>+10s</span>
          <Forward10Icon />
        </button>
        <button type="button" className="btn btn-ghost" onClick={stopAudio}>
          <StopIcon />
          <span>Stop</span>
        </button>

        <input
          type="range"
          className="seek-bar"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(currentTime, duration || 1)}
          onChange={(e) => {
            const next = parseFloat(e.target.value);
            setCurrentTime(next);
            if (audioRef.current) {
              audioRef.current.currentTime = next;
            }
          }}
          aria-label="Audio playback progress"
        />

        <span className="time-display">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <select
          value={playbackRate}
          onChange={(e) => {
            const rate = parseFloat(e.target.value);
            setPlaybackRate(rate);
            if (audioRef.current) {
              audioRef.current.playbackRate = rate;
            }
          }}
          aria-label="Playback speed"
        >
          <option value="0.75">0.75x</option>
          <option value="1">1.0x</option>
          <option value="1.25">1.25x</option>
          <option value="1.5">1.5x</option>
          <option value="2">2.0x</option>
        </select>
      </div>

      {error && <p className="error-banner">{error}</p>}
    </section>
  );
}
