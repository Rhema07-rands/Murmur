import type {
  DocumentUploadResponse,
  SpeechGenerateRequest,
  SpeechGenerateResponse,
  TranscriptionResponse,
  VoiceOption,
  WorkerHealthResponse,
} from '../types/murmur';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

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
    const response = await fetch(`${API_BASE}/api/speech/health`);
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<WorkerHealthResponse>;
  },

  async getAiVoices(): Promise<VoiceOption[]> {
    const response = await fetch(`${API_BASE}/api/speech/voices`);
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<VoiceOption[]>;
  },

  async generateAiSpeech(request: SpeechGenerateRequest): Promise<SpeechGenerateResponse> {
    const response = await fetch(`${API_BASE}/api/speech/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    const data = (await response.json()) as SpeechGenerateResponse;
    return {
      ...data,
      audioUrl: data.audioUrl.startsWith('http') ? data.audioUrl : `${API_BASE}${data.audioUrl}`,
      downloadUrl: data.downloadUrl.startsWith('http') ? data.downloadUrl : `${API_BASE}${data.downloadUrl}`,
    };
  },

  async uploadDocument(file: File): Promise<DocumentUploadResponse> {
    const form = new FormData();
    form.append('file', file);

    const response = await fetch(`${API_BASE}/api/documents/upload`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<DocumentUploadResponse>;
  },

  async deleteDocument(id: string): Promise<void> {
    await fetch(`${API_BASE}/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async transcribeAudio(file: File, language?: string): Promise<TranscriptionResponse> {
    const form = new FormData();
    form.append('file', file);
    if (language) {
      form.append('language', language);
    }

    const response = await fetch(`${API_BASE}/api/speech/transcribe`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<TranscriptionResponse>;
  },
};
