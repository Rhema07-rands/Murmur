import type {
  DocumentUploadResponse,
  SpeechGenerateRequest,
  SpeechGenerateResponse,
  SpeechJobStatus,
  TranscriptionResponse,
  VoiceOption,
  WorkerHealthResponse,
} from '../types/murmur';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

async function parseError(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = (await response.json()) as { error?: string; detail?: string };
      return data.error || data.detail || `Request failed with status ${response.status}`;
    }
    const text = await response.text();
    if (text && text.length < 200) {
      return text;
    }
    return `Server responded with HTTP ${response.status} (${response.statusText})`;
  } catch {
    return `Server responded with HTTP ${response.status}`;
  }
}

export const apiService = {
  getApiBase(): string {
    return API_BASE;
  },

  async getWorkerHealth(): Promise<WorkerHealthResponse> {
    if (!API_BASE && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return {
        available: false,
        engine: 'Cloud Neural AI',
        device: 'Needs API URL',
        chatterboxLoaded: false,
        whisperLoaded: false,
        error: 'VITE_API_BASE_URL is not set on Render. Please configure it in Render environment settings.',
      };
    }

    const response = await fetch(`${API_BASE}/api/speech/health`);
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<WorkerHealthResponse>;
  },

  async getAiVoices(): Promise<VoiceOption[]> {
    if (!API_BASE && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return [];
    }

    const response = await fetch(`${API_BASE}/api/speech/voices`);
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<VoiceOption[]>;
  },

  async generateAiSpeech(request: SpeechGenerateRequest): Promise<SpeechGenerateResponse> {
    if (!API_BASE && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      throw new Error('API connection not configured. Please add VITE_API_BASE_URL to your Render Static Site environment settings.');
    }

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

  async startSpeechJob(request: SpeechGenerateRequest): Promise<SpeechJobStatus> {
    if (!API_BASE && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      throw new Error('API connection not configured. Please add VITE_API_BASE_URL to your Render Static Site environment settings.');
    }

    const response = await fetch(`${API_BASE}/api/speech/generate-job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<SpeechJobStatus>;
  },

  async getSpeechJobStatus(jobId: string): Promise<SpeechJobStatus> {
    const response = await fetch(`${API_BASE}/api/speech/job/${jobId}`);
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    const data = (await response.json()) as SpeechJobStatus;
    return {
      ...data,
      audioUrl: data.audioUrl ? (data.audioUrl.startsWith('http') ? data.audioUrl : `${API_BASE}${data.audioUrl}`) : undefined,
      downloadUrl: data.downloadUrl ? (data.downloadUrl.startsWith('http') ? data.downloadUrl : `${API_BASE}${data.downloadUrl}`) : undefined,
    };
  },

  async cancelSpeechJob(jobId: string): Promise<void> {
    try {
      await fetch(`${API_BASE}/api/speech/job/${jobId}/cancel`, { method: 'POST' });
    } catch {
      // Ignore cancellation network errors
    }
  },

  async generateAiSpeechWithProgress(
    request: SpeechGenerateRequest,
    onProgress: (status: SpeechJobStatus) => void,
    abortSignal?: AbortSignal
  ): Promise<SpeechGenerateResponse> {
    const initialJob = await this.startSpeechJob(request);
    onProgress(initialJob);

    let currentJob = initialJob;
    while (currentJob.status === 'queued' || currentJob.status === 'processing') {
      if (abortSignal?.aborted) {
        await this.cancelSpeechJob(currentJob.jobId);
        throw new Error('Generation cancelled by user.');
      }

      await new Promise((r) => setTimeout(r, 1000));

      if (abortSignal?.aborted) {
        await this.cancelSpeechJob(currentJob.jobId);
        throw new Error('Generation cancelled by user.');
      }

      currentJob = await this.getSpeechJobStatus(currentJob.jobId);
      onProgress(currentJob);
    }

    if (currentJob.status === 'failed') {
      throw new Error(currentJob.error || 'Neural speech generation failed.');
    }

    if (currentJob.status === 'cancelled') {
      throw new Error('Speech generation was cancelled.');
    }

    if (!currentJob.audioUrl || !currentJob.downloadUrl || !currentJob.audioId) {
      throw new Error('Audio generation finished without producing an audio URL.');
    }

    return {
      audioId: currentJob.audioId,
      audioUrl: currentJob.audioUrl,
      downloadUrl: currentJob.downloadUrl,
      format: 'mp3',
      durationSeconds: null,
      chunkCount: currentJob.totalChunks,
    };
  },

  async uploadDocument(file: File): Promise<DocumentUploadResponse> {
    if (!API_BASE && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      throw new Error('API connection not configured. Please add VITE_API_BASE_URL to your Render Static Site environment settings.');
    }

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
    if (!API_BASE && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return;
    }
    await fetch(`${API_BASE}/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async transcribeAudio(file: File, language?: string): Promise<TranscriptionResponse> {
    if (!API_BASE && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      throw new Error('API connection not configured. Please add VITE_API_BASE_URL to your Render Static Site environment settings.');
    }

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
