import type { SpeechEngine, VoiceOption } from '../types/murmur';

interface VoiceSelectorProps {
  engine: SpeechEngine;
  onEngineChange: (engine: SpeechEngine) => void;
  browserVoices: SpeechSynthesisVoice[];
  selectedBrowserVoiceURI: string;
  onBrowserVoiceChange: (uri: string) => void;
  selectedLanguage: string;
  onLanguageChange: (lang: string) => void;
  aiVoices: VoiceOption[];
  selectedAiVoiceId: string;
  onAiVoiceChange: (id: string) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  pitch: number;
  onPitchChange: (pitch: number) => void;
  exaggeration: number;
  onExaggerationChange: (val: number) => void;
  aiAvailable: boolean;
}

export function VoiceSelector({
  engine,
  onEngineChange,
  browserVoices,
  selectedBrowserVoiceURI,
  onBrowserVoiceChange,
  selectedLanguage,
  onLanguageChange,
  aiVoices,
  selectedAiVoiceId,
  onAiVoiceChange,
  speed,
  onSpeedChange,
  pitch,
  onPitchChange,
  exaggeration,
  onExaggerationChange,
  aiAvailable,
}: VoiceSelectorProps) {
  const browserLanguages = Array.from(
    new Set(browserVoices.map((v) => v.lang))
  ).sort();

  const filteredBrowserVoices =
    selectedLanguage === 'all'
      ? browserVoices
      : browserVoices.filter((v) => v.lang === selectedLanguage);

  return (
    <section className="card">
      <h2>Voice &amp; Speech Settings</h2>

      <div className="engine-toggle" role="radiogroup" aria-label="Speech engine">
        <button
          type="button"
          className={`toggle-btn ${engine === 'browser' ? 'active' : ''}`}
          onClick={() => onEngineChange('browser')}
        >
          <strong>Basic Speech</strong>
          <span>Browser / OS Voices (Free, Instant)</span>
        </button>
        <button
          type="button"
          className={`toggle-btn ${engine === 'ai' ? 'active' : ''}`}
          onClick={() => onEngineChange('ai')}
        >
          <strong>AI Speech (Chatterbox)</strong>
          <span>{aiAvailable ? 'Local GPU Neural TTS + MP3 Export' : 'Worker Offline — Start Python Worker'}</span>
        </button>
      </div>

      {engine === 'browser' ? (
        <div className="controls-grid">
          <label className="field">
            <span>Language / Accent</span>
            <select
              value={selectedLanguage}
              onChange={(e) => {
                const nextLang = e.target.value;
                onLanguageChange(nextLang);
                const firstMatch =
                  nextLang === 'all'
                    ? browserVoices[0]
                    : browserVoices.find((v) => v.lang === nextLang);
                if (firstMatch) {
                  onBrowserVoiceChange(firstMatch.voiceURI);
                }
              }}
            >
              <option value="all">All Languages ({browserVoices.length})</option>
              {browserLanguages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Voice</span>
            <select
              value={selectedBrowserVoiceURI}
              onChange={(e) => onBrowserVoiceChange(e.target.value)}
            >
              {filteredBrowserVoices.length === 0 ? (
                <option value="">No system voices detected</option>
              ) : (
                filteredBrowserVoices.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name} ({voice.lang})
                  </option>
                ))
              )}
            </select>
          </label>
        </div>
      ) : (
        <div className="controls-grid">
          <label className="field">
            <span>AI Voice (Chatterbox)</span>
            <select
              value={selectedAiVoiceId}
              onChange={(e) => onAiVoiceChange(e.target.value)}
            >
              {aiVoices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name} — {voice.accent}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="sliders-grid">
        <label className="field">
          <span>Speed: {speed.toFixed(2)}x</span>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.05"
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
          />
        </label>

        {engine === 'browser' ? (
          <label className="field">
            <span>Pitch: {pitch.toFixed(2)}</span>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.05"
              value={pitch}
              onChange={(e) => onPitchChange(parseFloat(e.target.value))}
            />
          </label>
        ) : (
          <label className="field">
            <span>Expressiveness: {exaggeration.toFixed(2)}</span>
            <input
              type="range"
              min="0.1"
              max="1.2"
              step="0.05"
              value={exaggeration}
              onChange={(e) => onExaggerationChange(parseFloat(e.target.value))}
            />
          </label>
        )}
      </div>
    </section>
  );
}
