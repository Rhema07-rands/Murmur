# Murmur

A web-based Text-to-Speech & Document Reader application. Enter text, upload PDFs or EPUBs, and listen to them read aloud using browser voices or AI-generated neural speech.

## Architecture

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** (`Murmur.Client/`) | React + TypeScript + Vite | UI, browser TTS, audio playback |
| **Backend** (`Murmur.API/`) | ASP.NET Core Web API (C#) | REST API, PDF/EPUB extraction, audio delivery |
| **Speech Worker** (`Murmur.SpeechWorker/`) | Python + FastAPI | Chatterbox TTS (neural voices) + Faster-Whisper (transcription) |

## Prerequisites

- **Node.js** ≥ 20 LTS
- **.NET SDK** ≥ 10.0
- **Python** ≥ 3.11 (for AI speech worker)
- **FFmpeg** (for MP3 encoding)
- **NVIDIA GPU** recommended (CUDA) for fast AI speech generation

## Quick Start

### 1. Frontend (React)

```bash
cd Murmur.Client
npm install
npm run dev        # → http://localhost:5173
```

### 2. Backend (ASP.NET Core)

```bash
cd Murmur.API
dotnet run         # → http://localhost:5000
```

### 3. AI Speech Worker (optional — required for Chatterbox/Whisper)

```bash
cd Murmur.SpeechWorker
python -m venv .venv
.venv\Scripts\activate      # Windows
pip install -r requirements.txt
# Install PyTorch with CUDA:
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
uvicorn server:app --host 127.0.0.1 --port 8000
```

The frontend proxies `/api/*` requests to the backend. The backend forwards AI speech requests to the Python worker at `http://127.0.0.1:8000`.

## Features

- **Browser Speech**: Free, instant TTS using the Web Speech API (no server needed)
- **AI Speech (Chatterbox)**: Natural neural voices running locally on your GPU
- **Voice Cloning**: Drop a `.wav`/`.mp3` sample into `Murmur.SpeechWorker/voices/` to clone any voice
- **Faster-Whisper**: Audio-to-text transcription
- **PDF & EPUB Reader**: Upload documents, preview chapters/pages, select sections to read
- **MP3 Export**: Download generated AI speech as MP3 files
- **Customizable**: Speed, pitch, expressiveness controls

## Project Status

- [x] Project initialization & scaffolding
- [x] Frontend UI (text editor, voice selector, document uploader, audio player)
- [x] Browser TTS integration
- [x] ASP.NET Core API (speech + document endpoints)
- [x] Chatterbox TTS Python worker
- [x] Faster-Whisper transcription
- [x] PDF extraction (PdfPig)
- [x] EPUB extraction (VersOne.Epub)
- [ ] Voice cloning testing
- [ ] Mobile responsiveness refinement
- [ ] User accounts & history (future)
