import { useCallback, useEffect, useRef, useState } from 'react';
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

  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlayingAi, setIsPlayingAi] = useState(false);
  const [isAiPaused, setIsAiPaused] = useState(false);
  const [generatedAudio, setGeneratedAudio] = useState<SpeechGenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const globalAudioRef = useRef<HTMLAudioElement | null>(null);

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
        onProgress: (current, total) => setBrowserProgress({ current, total }),
        onEnd: () => {
          setIsSpeaking(false);
          setIsPaused(false);
          setBrowserProgress(null);
        },
        onError: (msg) => {
          setIsSpeaking(false);
          setIsPaused(false);
          setBrowserProgress(null);
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

    if (textToSpeak.length > 50_000) {
      setError('Text exceeds the 50,000 character limit per request.');
      return;
    }

    if (globalAudioRef.current) {
      globalAudioRef.current.pause();
      globalAudioRef.current = null;
    }

    setIsGenerating(true);
    setIsAiPaused(false);

    try {
      const result = await apiService.generateAiSpeech({
        text: textToSpeak,
        voiceId: selectedAiVoiceId,
        language: 'en',
        speed,
        exaggeration,
        cfgWeight: 0.5,
      });

      setGeneratedAudio(result);

      const audio = new Audio(result.audioUrl);
      globalAudioRef.current = audio;
      audio.playbackRate = speed;

      audio.onplay = () => {
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
        globalAudioRef.current = null;
      };
      audio.onerror = () => {
        setIsPlayingAi(false);
        setIsAiPaused(false);
        globalAudioRef.current = null;
      };

      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI speech generation failed.');
    } finally {
      setIsGenerating(false);
    }
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
      globalAudioRef.current = null;
    }
    setIsPlayingAi(false);
    setIsAiPaused(false);
  };

  const handleSkipAi = (seconds: number) => {
    if (globalAudioRef.current) {
      const current = globalAudioRef.current.currentTime;
      const duration = globalAudioRef.current.duration || 0;
      globalAudioRef.current.currentTime = Math.max(0, Math.min(duration, current + seconds));
    }
  };

  return (
    <div className="app-shell">
      <Header workerHealth={workerHealth} onRefreshHealth={() => void refreshWorker()} />

      <main className="main-grid">
        <div className="primary-col">
          <TextEditor
            text={text}
            onChange={(val) => {
              setText(val);
            }}
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
            onSpeedChange={(val) => {
              setSpeed(val);
              if (globalAudioRef.current) {
                globalAudioRef.current.playbackRate = val;
              }
            }}
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
            isPlayingAi={isPlayingAi}
            isAiPaused={isAiPaused}
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
            }}
            onPlayAi={() => void handlePlayAi()}
            onPauseAi={handlePauseAi}
            onResumeAi={() => void handleResumeAi()}
            onStopAi={handleStopAi}
            onSkipAi={handleSkipAi}
          />

          {error && <p className="error-banner">{error}</p>}

          <AudioPlayer generated={generatedAudio} audioRefShared={globalAudioRef} />
        </div>
      </main>
    </div>
  );
}

export default App;
