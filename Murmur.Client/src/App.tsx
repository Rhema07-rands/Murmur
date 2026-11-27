import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioPlayer } from './components/AudioPlayer';
import { DocumentUploader } from './components/DocumentUploader';
import { Header } from './components/Header';
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

export function App() {
  const [text, setText] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [engine, setEngine] = useState<SpeechEngine>('ai');
  const [workerHealth, setWorkerHealth] = useState<WorkerHealthResponse>({
    available: true,
    engine: 'Cloud Neural AI',
    device: 'Cloud',
    chatterboxLoaded: false,
    whisperLoaded: false,
  });

  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedBrowserVoiceURI, setSelectedBrowserVoiceURI] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('all');

  const [aiVoices, setAiVoices] = useState<VoiceOption[]>(DEFAULT_AI_VOICES);
  const [selectedAiVoiceId, setSelectedAiVoiceId] = useState('en-US-JennyNeural');

  const [speed, setSpeed] = useState(1.0);
  const [pitch, setPitch] = useState(1.0);
  const [exaggeration, setExaggeration] = useState(0.5);

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
  const [generationProgress, setGenerationProgress] = useState<SpeechJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const globalAudioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;

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

    if (textToSpeak.length > 100_000) {
      setError('Text exceeds the 100,000 character limit per request. Please select fewer sections.');
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

    const estChunks = Math.max(1, Math.ceil(textToSpeak.length / 5000));
    setGenerationProgress({
      jobId: '',
      status: 'processing',
      progressPercent: 0,
      currentChunk: 1,
      totalChunks: estChunks,
      processedCharacters: 0,
      totalCharacters: textToSpeak.length,
      estimatedSecondsRemaining: Math.max(2, estChunks * 3),
    });

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
        },
        abortController.signal
      );

      setSpokenAiText(textToSpeak);
      setGeneratedAudio(result);

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

  const handleSeekAi = (nextTime: number) => {
    if (globalAudioRef.current) {
      const duration = globalAudioRef.current.duration || aiDuration || 0;
      const clamped = Math.max(0, Math.min(duration, nextTime));
      globalAudioRef.current.currentTime = clamped;
      setAiCurrentTime(clamped);
    }
  };

  const handleSkipAi = (seconds: number) => {
    if (globalAudioRef.current) {
      handleSeekAi(globalAudioRef.current.currentTime + seconds);
    }
  };

  return (
    <div className="app-shell">
      <Header workerHealth={workerHealth} onRefreshHealth={() => void refreshWorker()} />

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
          />

          {error && <p className="error-banner">{error}</p>}

          <AudioPlayer generated={generatedAudio} />
        </div>
      </main>
    </div>
  );
}

export default App;
