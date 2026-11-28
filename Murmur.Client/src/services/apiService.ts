import type {
  AuthResponse,
  DocumentUploadResponse,
  NovelChapterDetail,
  NovelChapterSummary,
  NovelImportJobStatus,
  NovelSummary,
  NovelUploadResponse,
  SaveDocumentRequest,
  SavedDocumentDetail,
  SavedDocumentSummary,
  SpeechGenerateRequest,
  SpeechGenerateResponse,
  SpeechJobStatus,
  TranscriptionResponse,
  UserProfile,
  VoiceOption,
  WorkerHealthResponse,
} from '../types/murmur';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

function getAuthHeader(): Record<string, string> {
  try {
    const token = localStorage.getItem('murmur_auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

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

  async listSavedDocuments(folder?: string): Promise<SavedDocumentSummary[]> {
    const query = folder && folder !== 'All' ? `?folder=${encodeURIComponent(folder)}` : '';
    const response = await fetch(`${API_BASE}/api/library/documents${query}`, {
      headers: { ...getAuthHeader() },
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<SavedDocumentSummary[]>;
  },

  async listFolders(): Promise<string[]> {
    const response = await fetch(`${API_BASE}/api/library/folders`, {
      headers: { ...getAuthHeader() },
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<string[]>;
  },

  async getSavedDocument(id: string): Promise<SavedDocumentDetail> {
    const response = await fetch(`${API_BASE}/api/library/documents/${encodeURIComponent(id)}`, {
      headers: { ...getAuthHeader() },
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<SavedDocumentDetail>;
  },

  async saveDocumentToLibrary(request: SaveDocumentRequest): Promise<SavedDocumentSummary> {
    const response = await fetch(`${API_BASE}/api/library/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<SavedDocumentSummary>;
  },

  async deleteSavedDocument(id: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/library/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { ...getAuthHeader() },
    });
    if (!response.ok && response.status !== 204) {
      throw new Error(await parseError(response));
    }
  },

  async startUploadNovelJob(
    file: File,
    onUploadBytes?: (percent: number, loaded: number, total: number) => void
  ): Promise<NovelImportJobStatus> {
    if (!API_BASE && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      throw new Error('API connection not configured.');
    }

    return new Promise<NovelImportJobStatus>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api/novels/upload-job`);

      const headers = getAuthHeader();
      for (const [key, val] of Object.entries(headers)) {
        xhr.setRequestHeader(key, val);
      }

      if (xhr.upload && onUploadBytes) {
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable && evt.total > 0) {
            const pct = Math.round((evt.loaded / evt.total) * 100);
            onUploadBytes(pct, evt.loaded, evt.total);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText) as NovelImportJobStatus;
            resolve(data);
          } catch {
            reject(new Error('Invalid response from server.'));
          }
        } else {
          try {
            const err = JSON.parse(xhr.responseText) as { error?: string };
            reject(new Error(err.error || `Server responded with ${xhr.status}`));
          } catch {
            reject(new Error(`Server responded with HTTP ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => {
        reject(new Error('Network error uploading file.'));
      };

      const form = new FormData();
      form.append('file', file);
      xhr.send(form);
    });
  },

  async getNovelJobStatus(jobId: string): Promise<NovelImportJobStatus> {
    const response = await fetch(`${API_BASE}/api/novels/jobs/${encodeURIComponent(jobId)}`, {
      headers: { ...getAuthHeader() },
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<NovelImportJobStatus>;
  },

  async uploadNovelWithProgress(
    file: File,
    onProgress: (status: NovelImportJobStatus) => void,
    onUploadBytes?: (percent: number, loaded: number, total: number) => void
  ): Promise<NovelUploadResponse> {
    const initialJob = await this.startUploadNovelJob(file, onUploadBytes);
    onProgress(initialJob);

    let currentJob = initialJob;
    while (currentJob.status === 'processing') {
      await new Promise((r) => setTimeout(r, 1000));
      currentJob = await this.getNovelJobStatus(currentJob.jobId);
      onProgress(currentJob);
    }

    if (currentJob.status === 'failed') {
      throw new Error(currentJob.error || 'Failed to import and dissect EPUB novel.');
    }

    return {
      id: currentJob.novelId || '',
      title: currentJob.title || file.name,
      author: null,
      totalChapters: currentJob.totalChapters,
      totalCharacters: 0,
      message: `Successfully imported ${currentJob.totalChapters} chapters.`,
    };
  },

  async listNovels(): Promise<NovelSummary[]> {
    const response = await fetch(`${API_BASE}/api/novels`, {
      headers: { ...getAuthHeader() },
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<NovelSummary[]>;
  },

  async getNovel(novelId: string): Promise<NovelSummary> {
    const response = await fetch(`${API_BASE}/api/novels/${encodeURIComponent(novelId)}`, {
      headers: { ...getAuthHeader() },
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<NovelSummary>;
  },

  async listNovelChapters(novelId: string): Promise<NovelChapterSummary[]> {
    const response = await fetch(`${API_BASE}/api/novels/${encodeURIComponent(novelId)}/chapters`, {
      headers: { ...getAuthHeader() },
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<NovelChapterSummary[]>;
  },

  async getNovelChapter(novelId: string, chapterIndex: number): Promise<NovelChapterDetail> {
    const response = await fetch(`${API_BASE}/api/novels/${encodeURIComponent(novelId)}/chapters/${chapterIndex}`, {
      headers: { ...getAuthHeader() },
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<NovelChapterDetail>;
  },

  async updateNovelProgress(novelId: string, chapterIndex: number): Promise<void> {
    await fetch(`${API_BASE}/api/novels/${encodeURIComponent(novelId)}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ chapterIndex }),
    });
  },

  async deleteNovel(novelId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/novels/${encodeURIComponent(novelId)}`, {
      method: 'DELETE',
      headers: { ...getAuthHeader() },
    });
    if (!response.ok && response.status !== 204) {
      throw new Error(await parseError(response));
    }
  },

  // ---- Auth APIs ----
  async register(username: string, password: string): Promise<AuthResponse> {
    const response = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<AuthResponse>;
  },

  async login(username: string, password: string): Promise<AuthResponse> {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<AuthResponse>;
  },

  async getMe(): Promise<UserProfile | null> {
    const auth = getAuthHeader();
    if (!auth.Authorization) return null;

    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { ...auth },
      });
      if (!response.ok) return null;
      return response.json() as Promise<UserProfile>;
    } catch {
      return null;
    }
  },
};
