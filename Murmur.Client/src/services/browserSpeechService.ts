export interface BrowserSpeechCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onError?: (message: string) => void;
  onProgress?: (currentChunk: number, totalChunks: number, currentText: string) => void;
}

export interface BrowserSpeakOptions {
  text: string;
  voiceURI?: string;
  rate: number;
  pitch: number;
}

class BrowserSpeechService {
  private stopped = false;

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  getVoices(): SpeechSynthesisVoice[] {
    if (!this.isSupported()) return [];
    return window.speechSynthesis.getVoices();
  }

  subscribeVoicesChanged(callback: (voices: SpeechSynthesisVoice[]) => void): () => void {
    if (!this.isSupported()) return () => {};
    const handler = () => callback(this.getVoices());
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', handler);
  }

  speak(options: BrowserSpeakOptions, callbacks: BrowserSpeechCallbacks = {}): void {
    if (!this.isSupported()) {
      callbacks.onError?.('Browser Web Speech API is not supported in this browser.');
      return;
    }

    this.stop();
    this.stopped = false;

    const chunks = this.chunkText(options.text, 220);
    if (chunks.length === 0) {
      callbacks.onError?.('Please enter some text to speak.');
      return;
    }

    const voices = this.getVoices();
    const selectedVoice = options.voiceURI
      ? voices.find((v) => v.voiceURI === options.voiceURI)
      : undefined;

    let index = 0;

    const speakNext = () => {
      if (this.stopped || index >= chunks.length) {
        if (!this.stopped) {
          callbacks.onEnd?.();
        }
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang;
      }
      utterance.rate = Math.max(0.5, Math.min(3.0, options.rate));
      utterance.pitch = Math.max(0.5, Math.min(2.0, options.pitch));

      utterance.onstart = () => {
        if (index === 0) callbacks.onStart?.();
        callbacks.onProgress?.(index + 1, chunks.length, chunks[index]);
      };

      utterance.onpause = () => callbacks.onPause?.();
      utterance.onresume = () => callbacks.onResume?.();

      utterance.onend = () => {
        index += 1;
        speakNext();
      };

      utterance.onerror = (event) => {
        if (event.error === 'interrupted' || event.error === 'canceled') {
          return;
        }
        this.stopped = true;
        callbacks.onError?.(`Speech synthesis error: ${event.error}`);
      };

      window.speechSynthesis.speak(utterance);
    };

    speakNext();
  }

  pause(): void {
    if (this.isSupported() && window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
    }
  }

  resume(): void {
    if (this.isSupported() && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.isSupported()) {
      window.speechSynthesis.cancel();
    }
  }

  private chunkText(text: string, maxChars: number): string[] {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];
    if (cleaned.length <= maxChars) return [cleaned];

    const sentences = cleaned.split(/(?<=[.!?])\s+/);
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      if (sentence.length > maxChars) {
        if (current) {
          chunks.push(current.trim());
          current = '';
        }
        for (let i = 0; i < sentence.length; i += maxChars) {
          chunks.push(sentence.slice(i, i + maxChars).trim());
        }
      } else if ((current + ' ' + sentence).trim().length <= maxChars) {
        current = (current + ' ' + sentence).trim();
      } else {
        if (current) chunks.push(current.trim());
        current = sentence;
      }
    }

    if (current) chunks.push(current.trim());
    return chunks;
  }
}

export const browserSpeechService = new BrowserSpeechService();
