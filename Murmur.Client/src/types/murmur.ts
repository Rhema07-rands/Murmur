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
