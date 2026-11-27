import type {
  DocumentUploadResponse,
  SpeechGenerateRequest,
  SpeechGenerateResponse,
  TranscriptionResponse,
  VoiceOption,
  WorkerHealthResponse,
} from '../types/murmur';

async function parseError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string; detail?: string };
    return data.error || data.detail || `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

export const apiService = {
  async getWorkerHealth(): Promise<WorkerHealthResponse> {
    const response = await fetch('/api/speech/health');
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<WorkerHealthResponse>;
  },

  async getAiVoices(): Promise<VoiceOption[]> {
    const response = await fetch('/api/speech/voices');
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<VoiceOption[]>;
  },

  async generateAiSpeech(request: SpeechGenerateRequest): Promise<SpeechGenerateResponse> {
    const response = await fetch('/api/speech/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<SpeechGenerateResponse>;
  },

  async uploadDocument(file: File): Promise<DocumentUploadResponse> {
    const form = new FormData();
    form.append('file', file);

    const response = await fetch('/api/documents/upload', {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<DocumentUploadResponse>;
  },

  async deleteDocument(id: string): Promise<void> {
    await fetch(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async transcribeAudio(file: File, language?: string): Promise<TranscriptionResponse> {
    const form = new FormData();
    form.append('file', file);
    if (language) {
      form.append('language', language);
    }

    const response = await fetch('/api/speech/transcribe', {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<TranscriptionResponse>;
  },
};
