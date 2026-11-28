import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioPlayer } from './components/AudioPlayer';
import { AuthModal } from './components/AuthModal';
import { DocumentUploader } from './components/DocumentUploader';
import { Header } from './components/Header';
import { LightNovelReader } from './components/LightNovelReader';
import { SavedLibrary } from './components/SavedLibrary';
import { SpeechControls } from './components/SpeechControls';
import { TextEditor } from './components/TextEditor';
import { VoiceSelector } from './components/VoiceSelector';
import { apiService } from './services/apiService';
import { browserSpeechService } from './services/browserSpeechService';
import type {
  SpeechEngine,
  SpeechGenerateResponse,
  SpeechJobStatus,
  VoiceOption,
  WorkerHealthResponse,
} from './types/murmur';

const DEFAULT_AI_VOICES: VoiceOption[] = [
  { id: 'en-US-JennyNeural', name: 'Jenny (US Neural)', language: 'en-US', accent: 'United States', engine: 'cloud-neural', description: 'Warm, natural US English female neural voice' },
  { id: 'en-US-GuyNeural', name: 'Guy (US Neural)', language: 'en-US', accent: 'United States', engine: 'cloud-neural', description: 'Clear, natural US English male neural voice' },
  { id: 'en-US-AriaNeural', name: 'Aria (US Expressive)', language: 'en-US', accent: 'United States', engine: 'cloud-neural', description: 'Expressive US English female neural voice' },
  { id: 'en-US-ChristopherNeural', name: 'Christopher (US Casual)', language: 'en-US', accent: 'United States', engine: 'cloud-neural', description: 'Casual, friendly US English male neural voice' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia (UK Neural)', language: 'en-GB', accent: 'United Kingdom', engine: 'cloud-neural', description: 'Polished British English female neural voice' },
  { id: 'en-GB-RyanNeural', name: 'Ryan (UK Neural)', language: 'en-GB', accent: 'United Kingdom', engine: 'cloud-neural', description: 'Friendly British English male neural voice' },
  { id: 'en-AU-NatashaNeural', name: 'Natasha (AU Neural)', language: 'en-AU', accent: 'Australia', engine: 'cloud-neural', description: 'Natural Australian English female neural voice' },
  { id: 'es-ES-ElviraNeural', name: 'Elvira (Spanish Neural)', language: 'es-ES', accent: 'Spain', engine: 'cloud-neural', description: 'Natural Castilian Spanish female voice' },
  { id: 'fr-FR-DeniseNeural', name: 'Denise (French Neural)', language: 'fr-FR', accent: 'France', engine: 'cloud-neural', description: 'Standard French female neural voice' },
  { id: 'de-DE-KatjaNeural', name: 'Katja (German Neural)', language: 'de-DE', accent: 'Germany', engine: 'cloud-neural', description: 'Natural German female neural voice' },
  { id: 'ja-JP-NanamiNeural', name: 'Nanami (Japanese Neural)', language: 'ja-JP', accent: 'Japan', engine: 'cloud-neural', description: 'Standard Japanese female neural voice' },
];

interface TimedSentence {
  text: string;
  startRatio: number;
  endRatio: number;
}

function buildTimedSentences(rawText: string): TimedSentence[] {
  const cleaned = rawText.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const parts = cleaned.split(/(?<=[.!?])\s+/).filter((p) => p.trim().length > 0);
  const totalChars = parts.reduce((sum, p) => sum + p.length, 0) || 1;
  let offset = 0;
  return parts.map((part) => {
    const startRatio = offset / totalChars;
    offset += part.length;
    const endRatio = offset / totalChars;
    return { text: part, startRatio, endRatio };
  });
}

function getSavedString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function getSavedNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const parsed = parseFloat(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return fallback;
}

export function App() {
  const [text, setText] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [engine, setEngine] = useState<SpeechEngine>(() =>
    getSavedString('murmur_engine', 'ai') === 'browser' ? 'browser' : 'ai'
  );
  const [workerHealth, setWorkerHealth] = useState<WorkerHealthResponse>({
    available: true,
    engine: 'Cloud Neural AI',
    device: 'Cloud',
    chatterboxLoaded: false,
    whisperLoaded: false,
  });

  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedBrowserVoiceURI, setSelectedBrowserVoiceURI] = useState(() =>
    getSavedString('murmur_browser_voice_uri', '')
  );
  const [selectedLanguage, setSelectedLanguage] = useState(() =>
    getSavedString('murmur_language', 'all')
  );

  const [aiVoices, setAiVoices] = useState<VoiceOption[]>(DEFAULT_AI_VOICES);
  const [selectedAiVoiceId, setSelectedAiVoiceId] = useState(() =>
    getSavedString('murmur_ai_voice_id', 'en-US-JennyNeural')
  );

  const [speed, setSpeed] = useState(() => getSavedNumber('murmur_speed', 1.0));
  const [pitch, setPitch] = useState(() => getSavedNumber('murmur_pitch', 1.0));
  const [exaggeration, setExaggeration] = useState(() =>
    getSavedNumber('murmur_exaggeration', 0.5)
  );

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [browserProgress, setBrowserProgress] = useState<{ current: number; total: number } | null>(null);
  const [browserSubtitle, setBrowserSubtitle] = useState('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlayingAi, setIsPlayingAi] = useState(false);
  const [isAiPaused, setIsAiPaused] = useState(false);
  const [aiCurrentTime, setAiCurrentTime] = useState(0);
  const [aiDuration, setAiDuration] = useState(0);
  const [spokenAiText, setSpokenAiText] = useState('');
  const [generatedAudio, setGeneratedAudio] = useState<SpeechGenerateResponse | null>(null);
  const [generatedVoiceId, setGeneratedVoiceId] = useState<string | null>(null);
  const [generatedExaggeration, setGeneratedExaggeration] = useState<number | null>(null);
  const [generationProgress, setGenerationProgress] = useState<SpeechJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Light Novel reading state
  const [activeNovelId, setActiveNovelId] = useState<string | null>(null);
  const [activeChapterIndex, setActiveChapterIndex] = useState<number | null>(null);

  // User Auth State
  const [currentUser, setCurrentUser] = useState<import('./types/murmur').UserProfile | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  useEffect(() => {
    void apiService.getMe().then((user) => {
      if (user) setCurrentUser(user);
    });
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('murmur_auth_token');
    localStorage.removeItem('murmur_user_id');
    localStorage.removeItem('murmur_username');
    setCurrentUser(null);
  };

  const globalAudioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pipWindowRef = useRef<Window | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const voiceChangedSinceGeneration =
    generatedAudio !== null &&
    (generatedVoiceId !== selectedAiVoiceId || generatedExaggeration !== exaggeration);

  // Persist model & playback preferences across page refreshes
  useEffect(() => {
    try {
      localStorage.setItem('murmur_engine', engine);
      localStorage.setItem('murmur_ai_voice_id', selectedAiVoiceId);
      localStorage.setItem('murmur_browser_voice_uri', selectedBrowserVoiceURI);
      localStorage.setItem('murmur_language', selectedLanguage);
      localStorage.setItem('murmur_speed', String(speed));
      localStorage.setItem('murmur_exaggeration', String(exaggeration));
      localStorage.setItem('murmur_pitch', String(pitch));
    } catch {
      // ignore storage errors
    }
  }, [engine, selectedAiVoiceId, selectedBrowserVoiceURI, selectedLanguage, speed, exaggeration, pitch]);

  const timedSentences = useMemo(() => buildTimedSentences(spokenAiText), [spokenAiText]);

  const aiSubtitle = useMemo(() => {
    if (!isPlayingAi && !isAiPaused) return '';
    if (timedSentences.length === 0) return '';
    if (aiDuration <= 0) return timedSentences[0].text;
    const ratio = Math.max(0, Math.min(0.9999, aiCurrentTime / aiDuration));
    const match = timedSentences.find((s) => ratio >= s.startRatio && ratio <= s.endRatio);
    return match ? match.text : timedSentences[timedSentences.length - 1].text;
  }, [isPlayingAi, isAiPaused, timedSentences, aiCurrentTime, aiDuration]);

  const currentSubtitle = engine === 'browser' ? browserSubtitle : aiSubtitle;

  const refreshWorker = useCallback(async () => {
    try {
      const health = await apiService.getWorkerHealth();
      setWorkerHealth(health);
      const voices = await apiService.getAiVoices();
      if (voices && voices.length > 0) {
        setAiVoices(voices);
      }
    } catch {
      // Retain defaults
    }
  }, []);

  useEffect(() => {
    void refreshWorker();
  }, [refreshWorker]);

  useEffect(() => {
    const loadVoices = (voices: SpeechSynthesisVoice[]) => {
      setBrowserVoices(voices);
      if (voices.length > 0) {
        setSelectedBrowserVoiceURI((prev) =>
          prev && voices.some((v) => v.voiceURI === prev) ? prev : voices[0].voiceURI
        );
      }
    };

    loadVoices(browserSpeechService.getVoices());
    return browserSpeechService.subscribeVoicesChanged(loadVoices);
  }, []);

  const applySpeedToAudio = (audio: HTMLAudioElement, rate: number) => {
    audio.preservesPitch = true;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
  };

  const handleSpeedChange = (nextSpeed: number) => {
    setSpeed(nextSpeed);
    speedRef.current = nextSpeed;
    if (globalAudioRef.current) {
      applySpeedToAudio(globalAudioRef.current, nextSpeed);
    }
  };

  const handlePlayBrowser = () => {
    setError(null);
    const textToSpeak = cursorPos > 0 ? text.slice(cursorPos) : text;
    if (!textToSpeak.trim()) {
      setError('Please enter text or position the cursor before some text.');
      return;
    }

    browserSpeechService.speak(
      {
        text: textToSpeak,
        voiceURI: selectedBrowserVoiceURI,
        rate: speed,
        pitch,
      },
      {
        onStart: () => {
          setIsSpeaking(true);
          setIsPaused(false);
        },
        onPause: () => setIsPaused(true),
        onResume: () => setIsPaused(false),
        onProgress: (current, total, chunkText) => {
          setBrowserProgress({ current, total });
          setBrowserSubtitle(chunkText);
        },
        onEnd: () => {
          setIsSpeaking(false);
          setIsPaused(false);
          setBrowserProgress(null);
          setBrowserSubtitle('');
        },
        onError: (msg) => {
          setIsSpeaking(false);
          setIsPaused(false);
          setBrowserProgress(null);
          setBrowserSubtitle('');
          setError(msg);
        },
      }
    );
  };

  const handlePlayAi = async () => {
    setError(null);
    const textToSpeak = cursorPos > 0 ? text.slice(cursorPos) : text;
    if (!textToSpeak.trim()) {
      setError('Please enter text or select a valid position to play from.');
      return;
    }

    if (textToSpeak.length > 500_000) {
      setError('Text exceeds the 500,000 character limit per request. Please select fewer sections.');
      return;
    }

    if (globalAudioRef.current) {
      globalAudioRef.current.pause();
      globalAudioRef.current = null;
    }

    setIsGenerating(true);
    setIsAiPaused(false);
    setAiCurrentTime(0);
    setAiDuration(0);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const estChunks = Math.max(1, Math.ceil(textToSpeak.length / 1200));
    setGenerationProgress({
      jobId: '',
      status: 'processing',
      progressPercent: 0,
      currentChunk: 1,
      totalChunks: estChunks,
      processedCharacters: 0,
      totalCharacters: textToSpeak.length,
      estimatedSecondsRemaining: Math.max(2, Math.ceil(estChunks * 1.2)),
    });

    // Request browser notification permission if not yet decided so background alerts work
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }

    try {
      const result = await apiService.generateAiSpeechWithProgress(
        {
          text: textToSpeak,
          voiceId: selectedAiVoiceId,
          language: 'en',
          speed: 1.0,
          exaggeration,
          cfgWeight: 0.5,
        },
        (status) => {
          setGenerationProgress(status);
          // Show progress in document title even when user switches to other tabs/apps
          document.title = `[${status.progressPercent}%] Murmur Generating Audio...`;
        },
        abortController.signal
      );

      // Notify user when completed if browser is in the background
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('Murmur Audio Ready', {
            body: `Finished generating audio (${textToSpeak.length.toLocaleString()} characters). Click to play.`,
            icon: '/favicon.ico',
          });
        } catch {
          // Ignore notification display failures
        }
      }
      document.title = 'Murmur - Text-to-Speech';

      setSpokenAiText(textToSpeak);
      setGeneratedAudio(result);
      setGeneratedVoiceId(selectedAiVoiceId);
      setGeneratedExaggeration(exaggeration);

      const audio = new Audio(result.audioUrl);
      globalAudioRef.current = audio;
      applySpeedToAudio(audio, speedRef.current);

      audio.onloadedmetadata = () => {
        if (Number.isFinite(audio.duration)) {
          setAiDuration(audio.duration);
        }
        applySpeedToAudio(audio, speedRef.current);
      };
      audio.ontimeupdate = () => {
        setAiCurrentTime(audio.currentTime);
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setAiDuration(audio.duration);
        }
      };
      audio.onplay = () => {
        applySpeedToAudio(audio, speedRef.current);
        setIsPlayingAi(true);
        setIsAiPaused(false);
      };
      audio.onpause = () => {
        if (!audio.ended) {
          setIsAiPaused(true);
          setIsPlayingAi(false);
        }
      };
      audio.onended = () => {
        setIsPlayingAi(false);
        setIsAiPaused(false);
      };
      audio.onerror = () => {
        setIsPlayingAi(false);
        setIsAiPaused(false);
        globalAudioRef.current = null;
      };

      await audio.play();
    } catch (err) {
      if ((err as Error).name === 'AbortError' || (err as Error).message.includes('cancelled')) {
        setError('Audio generation was cancelled.');
      } else {
        setError(err instanceof Error ? err.message : 'AI speech generation failed.');
      }
    } finally {
      document.title = 'Murmur - Text-to-Speech';
      setIsGenerating(false);
      setGenerationProgress(null);
      abortControllerRef.current = null;
    }
  };

  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsGenerating(false);
    setGenerationProgress(null);
  };

  const handlePauseAi = () => {
    if (globalAudioRef.current && !globalAudioRef.current.paused) {
      globalAudioRef.current.pause();
      setIsAiPaused(true);
      setIsPlayingAi(false);
    }
  };

  const handleResumeAi = async () => {
    if (globalAudioRef.current && globalAudioRef.current.paused) {
      try {
        applySpeedToAudio(globalAudioRef.current, speedRef.current);
        await globalAudioRef.current.play();
        setIsPlayingAi(true);
        setIsAiPaused(false);
      } catch {
        setError('Could not resume audio.');
      }
    }
  };

  const handleStopAi = () => {
    if (globalAudioRef.current) {
      globalAudioRef.current.pause();
      globalAudioRef.current.currentTime = 0;
    }
    setAiCurrentTime(0);
    setIsPlayingAi(false);
    setIsAiPaused(false);
  };

  const handleSeekAi = useCallback((nextTime: number) => {
    if (globalAudioRef.current) {
      const duration = globalAudioRef.current.duration || aiDuration || 0;
      const clamped = Math.max(0, Math.min(duration, nextTime));
      globalAudioRef.current.currentTime = clamped;
      setAiCurrentTime(clamped);
    }
  }, [aiDuration]);

  const handleSkipAi = useCallback((seconds: number) => {
    if (globalAudioRef.current) {
      handleSeekAi(globalAudioRef.current.currentTime + seconds);
    }
  }, [handleSeekAi]);

  // OS Media Notification / Lock Screen Controls + Progress Bar (Media Session API)
  useEffect(() => {
    if (!('mediaSession' in navigator) || !generatedAudio) return;

    const voiceName =
      aiVoices.find((v) => v.id === (generatedVoiceId ?? selectedAiVoiceId))?.name ?? 'Murmur Neural Voice';

    navigator.mediaSession.metadata = new MediaMetadata({
      title: docTitle || 'Murmur Audio Reading',
      artist: `${voiceName} (${speed}x)`,
      album: currentSubtitle ? currentSubtitle.slice(0, 80) : 'Murmur AI Reader',
    });

    navigator.mediaSession.playbackState = isPlayingAi
      ? 'playing'
      : isAiPaused
        ? 'paused'
        : 'none';

    navigator.mediaSession.setActionHandler('play', () => void handleResumeAi());
    navigator.mediaSession.setActionHandler('pause', () => handlePauseAi());
    navigator.mediaSession.setActionHandler('stop', () => handleStopAi());
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      handleSkipAi(-(details.seekOffset ?? 10));
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      handleSkipAi(details.seekOffset ?? 10);
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => handleSkipAi(-10));
    navigator.mediaSession.setActionHandler('nexttrack', () => handleSkipAi(10));
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') {
        handleSeekAi(details.seekTime);
      }
    });

    if ('setPositionState' in navigator.mediaSession && aiDuration > 0 && Number.isFinite(aiDuration)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: aiDuration,
          playbackRate: speed,
          position: Math.min(aiCurrentTime, aiDuration),
        });
      } catch {
        // ignore transient metadata states
      }
    }
  }, [
    generatedAudio,
    generatedVoiceId,
    selectedAiVoiceId,
    aiVoices,
    docTitle,
    currentSubtitle,
    isPlayingAi,
    isAiPaused,
    aiCurrentTime,
    aiDuration,
    speed,
    handleSkipAi,
    handleSeekAi,
  ]);

  // Keep Document Picture-in-Picture mini player synced when open
  const updatePipContent = useCallback(() => {
    const pipWin = pipWindowRef.current;
    if (!pipWin || pipWin.closed) return;

    const progressEl = pipWin.document.getElementById('pip-progress') as HTMLInputElement | null;
    const timerEl = pipWin.document.getElementById('pip-timer');
    const subEl = pipWin.document.getElementById('pip-sub');
    const playBtn = pipWin.document.getElementById('pip-play');
    const speedEl = pipWin.document.getElementById('pip-speed');

    const effElapsed = aiCurrentTime / speed;
    const effTotal = aiDuration / speed;
    const fmt = (s: number) => {
      if (!Number.isFinite(s) || s < 0) return '0:00';
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    if (progressEl) {
      progressEl.max = String(aiDuration || 1);
      progressEl.value = String(Math.min(aiCurrentTime, aiDuration || 1));
    }
    if (timerEl) timerEl.textContent = `${fmt(effElapsed)} / ${fmt(effTotal)}`;
    if (subEl) subEl.textContent = currentSubtitle || 'Ready to play';
    if (playBtn) playBtn.textContent = isPlayingAi ? 'Pause' : 'Play';
    if (speedEl) speedEl.textContent = `${speed}x`;
  }, [aiCurrentTime, aiDuration, speed, currentSubtitle, isPlayingAi]);

  useEffect(() => {
    updatePipContent();
  }, [updatePipContent]);

  const handleOpenMiniPlayer = async () => {
    const docPip = (window as unknown as {
      documentPictureInPicture?: { requestWindow: (opts: { width: number; height: number }) => Promise<Window> };
    }).documentPictureInPicture;

    if (!docPip) {
      setError('Floating Mini Player requires Chrome or Edge desktop. On mobile, use your OS notification shade controls.');
      return;
    }

    try {
      const pipWin = await docPip.requestWindow({ width: 380, height: 220 });
      pipWindowRef.current = pipWin;
      pipWin.document.body.style.cssText =
        'margin:0;padding:14px;background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif;display:flex;flex-direction:column;gap:10px;';

      pipWin.document.body.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:14px;color:#fda4af;">Murmur Mini Player</strong>
          <span id="pip-timer" style="font-size:12px;color:#94a3b8;">0:00 / 0:00</span>
        </div>
        <input id="pip-progress" type="range" min="0" max="1" step="0.1" style="width:100%;accent-color:#f43f5e;cursor:pointer;" />
        <div id="pip-sub" style="font-size:12px;color:#cbd5e1;background:#1e293b;padding:8px 10px;border-radius:8px;border-left:3px solid #6366f1;min-height:34px;overflow:hidden;"></div>
        <div style="display:flex;gap:6px;align-items:center;justify-content:space-between;">
          <div style="display:flex;gap:6px;">
            <button id="pip-back" style="padding:6px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#f8fafc;cursor:pointer;">-10s</button>
            <button id="pip-play" style="padding:6px 12px;border-radius:6px;border:none;background:#6366f1;color:#fff;font-weight:600;cursor:pointer;">Play</button>
            <button id="pip-fwd" style="padding:6px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#f8fafc;cursor:pointer;">+10s</button>
          </div>
          <div style="display:flex;gap:4px;align-items:center;">
            <button id="pip-speed-down" style="padding:5px 8px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#f8fafc;cursor:pointer;">-</button>
            <span id="pip-speed" style="font-size:12px;min-width:34px;text-align:center;font-weight:600;">${speedRef.current}x</span>
            <button id="pip-speed-up" style="padding:5px 8px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#f8fafc;cursor:pointer;">+</button>
          </div>
        </div>
      `;

      const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
      pipWin.document.getElementById('pip-back')?.addEventListener('click', () => handleSkipAi(-10));
      pipWin.document.getElementById('pip-fwd')?.addEventListener('click', () => handleSkipAi(10));
      pipWin.document.getElementById('pip-play')?.addEventListener('click', () => {
        if (globalAudioRef.current?.paused) {
          void handleResumeAi();
        } else {
          handlePauseAi();
        }
      });
      pipWin.document.getElementById('pip-progress')?.addEventListener('input', (ev) => {
        const val = parseFloat((ev.target as HTMLInputElement).value);
        handleSeekAi(val);
      });
      pipWin.document.getElementById('pip-speed-up')?.addEventListener('click', () => {
        const idx = SPEED_STEPS.findIndex((s) => s >= speedRef.current);
        const next = SPEED_STEPS[Math.min(SPEED_STEPS.length - 1, (idx === -1 ? 2 : idx) + 1)];
        handleSpeedChange(next);
      });
      pipWin.document.getElementById('pip-speed-down')?.addEventListener('click', () => {
        const idx = SPEED_STEPS.findIndex((s) => s >= speedRef.current);
        const next = SPEED_STEPS[Math.max(0, (idx === -1 ? 2 : idx) - 1)];
        handleSpeedChange(next);
      });

      updatePipContent();
    } catch {
      setError('Could not open floating Mini Player.');
    }
  };

  return (
    <div className="app-shell">
      <Header
        workerHealth={workerHealth}
        onRefreshHealth={() => void refreshWorker()}
        currentUser={currentUser}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onLogout={handleLogout}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={(user) => {
          setCurrentUser(user);
        }}
      />

      <main className="main-grid">
        <div className="primary-col">
          <TextEditor
            text={text}
            onChange={(val) => setText(val)}
            onCursorChange={(pos) => setCursorPos(pos)}
            aiAvailable={workerHealth?.available ?? true}
          />

          <DocumentUploader
            onLoadText={(loaded) => {
              setText(loaded);
              setCursorPos(0);
              setError(null);
            }}
          />

          <SavedLibrary
            currentText={text}
            suggestedTitle={docTitle}
            onLoadDocument={(loadedContent, loadedTitle) => {
              setText(loadedContent);
              setDocTitle(loadedTitle);
              setCursorPos(0);
              setError(null);
            }}
          />

          <LightNovelReader
            activeReadingNovelId={activeNovelId}
            activeReadingChapterIndex={activeChapterIndex}
            onReadChapter={(chapterContent, chapterTitle, novelId, chapterIndex) => {
              setText(chapterContent);
              setDocTitle(chapterTitle);
              setActiveNovelId(novelId);
              setActiveChapterIndex(chapterIndex);
              setCursorPos(0);
              setError(null);
              // Scroll up to reader/controls
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </div>

        <div className="secondary-col">
          <VoiceSelector
            engine={engine}
            onEngineChange={(next) => {
              browserSpeechService.stop();
              handleStopAi();
              setIsSpeaking(false);
              setIsPaused(false);
              setBrowserProgress(null);
              setBrowserSubtitle('');
              setEngine(next);
            }}
            browserVoices={browserVoices}
            selectedBrowserVoiceURI={selectedBrowserVoiceURI}
            onBrowserVoiceChange={setSelectedBrowserVoiceURI}
            selectedLanguage={selectedLanguage}
            onLanguageChange={setSelectedLanguage}
            aiVoices={aiVoices}
            selectedAiVoiceId={selectedAiVoiceId}
            onAiVoiceChange={setSelectedAiVoiceId}
            speed={speed}
            onSpeedChange={handleSpeedChange}
            pitch={pitch}
            onPitchChange={setPitch}
            exaggeration={exaggeration}
            onExaggerationChange={setExaggeration}
            aiAvailable={true}
          />

          <SpeechControls
            engine={engine}
            isSpeaking={isSpeaking}
            isPaused={isPaused}
            isGenerating={isGenerating}
            generationProgress={generationProgress}
            isPlayingAi={isPlayingAi}
            isAiPaused={isAiPaused}
            hasAiAudio={generatedAudio !== null}
            voiceChangedSinceGeneration={voiceChangedSinceGeneration}
            aiCurrentTime={aiCurrentTime}
            aiDuration={aiDuration}
            speed={speed}
            currentSubtitle={currentSubtitle}
            browserProgress={browserProgress}
            startCursorPos={cursorPos}
            onPlayBrowser={handlePlayBrowser}
            onPauseBrowser={() => browserSpeechService.pause()}
            onResumeBrowser={() => browserSpeechService.resume()}
            onStopBrowser={() => {
              browserSpeechService.stop();
              setIsSpeaking(false);
              setIsPaused(false);
              setBrowserProgress(null);
              setBrowserSubtitle('');
            }}
            onPlayAi={() => void handlePlayAi()}
            onPauseAi={handlePauseAi}
            onResumeAi={() => void handleResumeAi()}
            onStopAi={handleStopAi}
            onSkipAi={handleSkipAi}
            onSeekAi={handleSeekAi}
            onCancelGeneration={handleCancelGeneration}
            onOpenMiniPlayer={() => void handleOpenMiniPlayer()}
          />

          {error && <p className="error-banner">{error}</p>}

          <AudioPlayer generated={generatedAudio} />
        </div>
      </main>
    </div>
  );
}

export default App;
