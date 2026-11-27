import { useState } from 'react';
import type { SpeechEngine, VoiceOption } from '../types/murmur';
import { ChevronDownIcon } from './Icons';

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

const EXPRESSIVENESS_OPTIONS = [
  { value: 0.25, label: 'Subtle (0.25)' },
  { value: 0.5, label: 'Natural (0.50)' },
  { value: 0.75, label: 'Expressive (0.75)' },
  { value: 1.0, label: 'Dramatic (1.00)' },
  { value: 1.2, label: 'Intense (1.20)' },
];

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
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [expressivenessMenuOpen, setExpressivenessMenuOpen] = useState(false);

  const selectedExpressivenessLabel =
    EXPRESSIVENESS_OPTIONS.find((o) => Math.abs(o.value - exaggeration) < 0.01)?.label ??
    `Custom (${exaggeration.toFixed(2)})`;

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
          <strong>AI Neural Voices</strong>
          <span>{aiAvailable ? 'High-Def AI Voices & MP3 Export' : 'Connecting to API...'}</span>
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
            <span>AI Neural Voice</span>
            <select
              value={selectedAiVoiceId}
              onChange={(e) => onAiVoiceChange(e.target.value)}
            >
              {aiVoices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name} ({voice.accent})
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="sliders-grid">
        <div className="field speed-picker">
          <span>Playback Speed</span>
          <button
            type="button"
            className="btn btn-secondary speed-trigger"
            onClick={() => setSpeedMenuOpen((open) => !open)}
            aria-expanded={speedMenuOpen}
          >
            <span>{speed}x</span>
            <ChevronDownIcon rotated={speedMenuOpen} />
          </button>

          {speedMenuOpen && (
            <div className="speed-menu" role="menu" aria-label="Select playback speed">
              {SPEED_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  role="menuitemradio"
                  aria-checked={speed === opt}
                  className={`speed-option ${speed === opt ? 'active' : ''}`}
                  onClick={() => {
                    onSpeedChange(opt);
                    setSpeedMenuOpen(false);
                  }}
                >
                  {opt}x
                </button>
              ))}
            </div>
          )}
        </div>

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
          <div className="field speed-picker">
            <span>Expressiveness</span>
            <button
              type="button"
              className="btn btn-secondary speed-trigger"
              onClick={() => {
                setExpressivenessMenuOpen((open) => !open);
                setSpeedMenuOpen(false);
              }}
              aria-expanded={expressivenessMenuOpen}
            >
              <span>{selectedExpressivenessLabel}</span>
              <ChevronDownIcon rotated={expressivenessMenuOpen} />
            </button>

            {expressivenessMenuOpen && (
              <div className="speed-menu" role="menu" aria-label="Select expressiveness level">
                {EXPRESSIVENESS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={Math.abs(exaggeration - opt.value) < 0.01}
                    className={`speed-option ${Math.abs(exaggeration - opt.value) < 0.01 ? 'active' : ''}`}
                    onClick={() => {
                      onExaggerationChange(opt.value);
                      setExpressivenessMenuOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
