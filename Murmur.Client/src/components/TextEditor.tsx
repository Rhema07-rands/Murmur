import { useRef, useState } from 'react';
import { apiService } from '../services/apiService';

interface TextEditorProps {
  text: string;
  onChange: (value: string) => void;
  onCursorChange?: (cursorPos: number) => void;
  maxChars?: number;
  aiAvailable: boolean;
}

export function TextEditor({
  text,
  onChange,
  onCursorChange,
  maxChars = 100_000,
  aiAvailable,
}: TextEditorProps) {
  const audioInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const overLimit = charCount > maxChars;

  const handleTranscribeFile = async (file: File) => {
    setTranscribeError(null);
    setTranscribing(true);
    try {
      const result = await apiService.transcribeAudio(file);
      onChange(text ? `${text}\n\n${result.text}` : result.text);
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : 'Transcription failed.');
    } finally {
      setTranscribing(false);
    }
  };

  const notifyCursor = () => {
    if (textareaRef.current && onCursorChange) {
      const pos = textareaRef.current.selectionStart;
      onCursorChange(pos);
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2>Text Input</h2>
        <div className="card-actions">
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void handleTranscribeFile(file);
              }
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!aiAvailable || transcribing}
            title={
              aiAvailable
                ? 'Transcribe an audio file into text using Faster-Whisper'
                : 'Start Murmur.SpeechWorker to enable Faster-Whisper transcription'
            }
            onClick={() => audioInputRef.current?.click()}
          >
            {transcribing ? 'Transcribing...' : 'Transcribe Audio (Whisper)'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!text}
            onClick={() => {
              onChange('');
              onCursorChange?.(0);
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <textarea
        ref={textareaRef}
        className={`text-editor ${overLimit ? 'invalid' : ''}`}
        value={text}
        onChange={(e) => {
          onChange(e.target.value);
          notifyCursor();
        }}
        onClick={notifyCursor}
        onKeyUp={notifyCursor}
        onSelect={notifyCursor}
        placeholder="Type or paste text here, or upload a .pdf / .epub / .docx document below... (Click anywhere in the text to start reading from that spot!)"
        rows={10}
        aria-label="Text to convert to speech"
      />

      <div className="editor-footer">
        <span className={overLimit ? 'text-danger' : 'text-muted'}>
          {charCount.toLocaleString()} / {maxChars.toLocaleString()} characters · {wordCount.toLocaleString()} words
        </span>
        {overLimit && (
          <span className="text-danger">
            Exceeds {maxChars.toLocaleString()} character limit for a single AI generation request.
          </span>
        )}
      </div>

      {transcribeError && <p className="error-banner">{transcribeError}</p>}
    </section>
  );
}
