import { useCallback, useEffect, useState } from 'react';
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

export function App() {
  const [text, setText] = useState('');
  const [engine, setEngine] = useState<SpeechEngine>('browser');
  const [workerHealth, setWorkerHealth] = useState<WorkerHealthResponse | null>(null);

  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedBrowserVoiceURI, setSelectedBrowserVoiceURI] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('all');

  const [aiVoices, setAiVoices] = useState<VoiceOption[]>([
    {
      id: 'default',
      name: 'Chatterbox Default',
      language: 'en',
      accent: 'Neutral',
      engine: 'chatterbox',
      description: 'Built-in Chatterbox neural voice',
    },
  ]);
  const [selectedAiVoiceId, setSelectedAiVoiceId] = useState('default');

  const [speed, setSpeed] = useState(1.0);
  const [pitch, setPitch] = useState(1.0);
  const [exaggeration, setExaggeration] = useState(0.5);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [browserProgress, setBrowserProgress] = useState<{ current: number; total: number } | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAudio, setGeneratedAudio] = useState<SpeechGenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshWorker = useCallback(async () => {
    try {
      const health = await apiService.getWorkerHealth();
      setWorkerHealth(health);
      if (health.available) {
        const voices = await apiService.getAiVoices();
        if (voices.length > 0) {
          setAiVoices(voices);
        }
      }
    } catch {
      setWorkerHealth({
        available: false,
        engine: 'Chatterbox',
        device: 'offline',
        chatterboxLoaded: false,
        whisperLoaded: false,
        error: 'Backend API is not reachable.',
      });
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
    if (!text.trim()) {
      setError('Please enter text or load a document before playing speech.');
      return;
    }

    browserSpeechService.speak(
      {
        text,
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

  const handleGenerateAi = async () => {
    setError(null);
    if (!text.trim()) {
      setError('Please enter text or load a document before generating AI speech.');
      return;
    }

    if (text.length > 50_000) {
      setError('Text exceeds the 50,000 character limit per request.');
      return;
    }

    setIsGenerating(true);
    try {
      const result = await apiService.generateAiSpeech({
        text,
        voiceId: selectedAiVoiceId,
        language: 'en',
        speed,
        exaggeration,
        cfgWeight: 0.5,
      });
      setGeneratedAudio(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI speech generation failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="app-shell">
      <Header workerHealth={workerHealth} onRefreshHealth={() => void refreshWorker()} />

      <main className="main-grid">
        <div className="primary-col">
          <TextEditor
            text={text}
            onChange={setText}
            aiAvailable={workerHealth?.available ?? false}
          />

          <DocumentUploader
            onLoadText={(loaded) => {
              setText(loaded);
              setError(null);
            }}
          />
        </div>

        <div className="secondary-col">
          <VoiceSelector
            engine={engine}
            onEngineChange={(next) => {
              browserSpeechService.stop();
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
            onSpeedChange={setSpeed}
            pitch={pitch}
            onPitchChange={setPitch}
            exaggeration={exaggeration}
            onExaggerationChange={setExaggeration}
            aiAvailable={workerHealth?.available ?? false}
          />

          <SpeechControls
            engine={engine}
            isSpeaking={isSpeaking}
            isPaused={isPaused}
            isGenerating={isGenerating}
            browserProgress={browserProgress}
            onPlayBrowser={handlePlayBrowser}
            onPauseBrowser={() => browserSpeechService.pause()}
            onResumeBrowser={() => browserSpeechService.resume()}
            onStopBrowser={() => {
              browserSpeechService.stop();
              setIsSpeaking(false);
              setIsPaused(false);
              setBrowserProgress(null);
            }}
            onGenerateAi={() => void handleGenerateAi()}
          />

          {error && <p className="error-banner">{error}</p>}

          <AudioPlayer generated={generatedAudio} />
        </div>
      </main>
    </div>
  );
}

export default App;
