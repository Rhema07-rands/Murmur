export type SpeechEngine = 'browser' | 'ai';

export interface VoiceOption {
  id: string;
  name: string;
  language: string;
  accent: string;
  engine: string;
  description: string;
}

export interface SpeechGenerateRequest {
  text: string;
  voiceId?: string;
  language?: string;
  speed: number;
  exaggeration: number;
  cfgWeight: number;
}

export interface SpeechGenerateResponse {
  audioId: string;
  audioUrl: string;
  downloadUrl: string;
  format: string;
  durationSeconds: number | null;
  chunkCount: number;
}

export interface SpeechJobStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progressPercent: number;
  currentChunk: number;
  totalChunks: number;
  processedCharacters: number;
  totalCharacters: number;
  estimatedSecondsRemaining: number;
  audioId?: string;
  audioUrl?: string;
  downloadUrl?: string;
  error?: string;
}

export interface WorkerHealthResponse {
  available: boolean;
  engine: string;
  device: string;
  chatterboxLoaded: boolean;
  whisperLoaded: boolean;
  error?: string;
}

export interface DocumentSection {
  index: number;
  title: string;
  content: string;
  characterCount: number;
}

export interface DocumentUploadResponse {
  id: string;
  fileName: string;
  fileType: 'pdf' | 'epub' | 'docx';
  title: string;
  author: string | null;
  totalCharacters: number;
  sectionCount: number;
  sections: DocumentSection[];
}

export interface TranscriptionResponse {
  text: string;
  language: string;
  durationSeconds: number;
}

export interface SaveDocumentRequest {
  title: string;
  folderName: string;
  content: string;
  fileType?: string;
}

export interface SavedDocumentSummary {
  id: string;
  folderName: string;
  title: string;
  fileType: string;
  characterCount: number;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface SavedDocumentDetail extends SavedDocumentSummary {
  content: string;
}

export interface NovelSummary {
  id: string;
  title: string;
  author: string | null;
  totalChapters: number;
  totalCharacters: number;
  lastReadChapter: number;
  coverColor: string | null;
  uploadedAtUtc: string;
}

export interface NovelChapterSummary {
  chapterIndex: number;
  title: string;
  characterCount: number;
}

export interface NovelChapterDetail {
  novelId: string;
  chapterIndex: number;
  title: string;
  content: string;
  characterCount: number;
  totalChapters: number;
}

export interface NovelUploadResponse {
  id: string;
  title: string;
  author: string | null;
  totalChapters: number;
  totalCharacters: number;
  message: string;
}

export interface NovelImportJobStatus {
  jobId: string;
  status: 'processing' | 'completed' | 'failed';
  progressPercent: number;
  stage: 'dissecting' | 'saving' | 'completed';
  processedChapters: number;
  totalChapters: number;
  novelId?: string;
  title?: string;
  error?: string;
}

export interface AuthResponse {
  token: string;
  userId: string;
  username: string;
}

export interface UserProfile {
  id: string;
  username: string;
  createdAtUtc: string;
}
