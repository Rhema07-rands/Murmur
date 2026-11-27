import io
import os
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Optional

import torch
import torchaudio
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(title="Murmur Speech Worker", version="1.0.0")

BASE_DIR = Path(__file__).resolve().parent
VOICES_DIR = BASE_DIR / "voices"
VOICES_DIR.mkdir(exist_ok=True)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

_tts_lock = threading.Lock()
_stt_lock = threading.Lock()
_tts_model = None
_stt_model = None


class TtsRequest(BaseModel):
    text: str
    voice_id: str = "default"
    language: str = "en"
    speed: float = 1.0
    exaggeration: float = 0.5
    cfg_weight: float = 0.5


def get_tts_model():
    global _tts_model
    if _tts_model is None:
        with _tts_lock:
            if _tts_model is None:
                from chatterbox.tts import ChatterboxTTS
                _tts_model = ChatterboxTTS.from_pretrained(device=DEVICE)
    return _tts_model


def get_stt_model():
    global _stt_model
    if _stt_model is None:
        with _stt_lock:
            if _stt_model is None:
                from faster_whisper import WhisperModel
                compute_type = "float16" if DEVICE == "cuda" else "int8"
                _stt_model = WhisperModel("base", device=DEVICE, compute_type=compute_type)
    return _stt_model


def chunk_text(text: str, max_chars: int = 260) -> list[str]:
    """Split text into sentence-aware chunks suitable for neural TTS."""
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return []
    if len(cleaned) <= max_chars:
        return [cleaned]

    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    chunks: list[str] = []
    current = ""

    for sentence in sentences:
        if len(sentence) > max_chars:
            if current:
                chunks.append(current.strip())
                current = ""
            words = sentence.split(" ")
            part = ""
            for word in words:
                if len(part) + len(word) + 1 <= max_chars:
                    part = f"{part} {word}".strip()
                else:
                    if part:
                        chunks.append(part)
                    part = word
            if part:
                chunks.append(part)
        elif len(current) + len(sentence) + 1 <= max_chars:
            current = f"{current} {sentence}".strip()
        else:
            if current:
                chunks.append(current.strip())
            current = sentence

    if current:
        chunks.append(current.strip())

    return chunks


def encode_wav_to_mp3(wav_path: Path, mp3_path: Path, speed: float = 1.0) -> None:
    ffmpeg_exe = shutil.which("ffmpeg")
    if not ffmpeg_exe:
        raise RuntimeError("ffmpeg is not installed or not on PATH.")

    cmd = [ffmpeg_exe, "-y", "-i", str(wav_path)]
    clamped_speed = max(0.5, min(2.0, speed))
    if abs(clamped_speed - 1.0) > 0.02:
        cmd.extend(["-filter:a", f"atempo={clamped_speed:.2f}"])
    cmd.extend(["-codec:a", "libmp3lame", "-qscale:a", "2", str(mp3_path)])

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr}")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": DEVICE,
        "chatterbox_loaded": _tts_model is not None,
        "whisper_loaded": _stt_model is not None,
    }


@app.get("/voices")
def list_voices():
    voices = [
        {
            "id": "default",
            "name": "Chatterbox Default",
            "language": "en",
            "accent": "Neutral",
            "engine": "chatterbox",
            "description": "Built-in Chatterbox neural voice",
        }
    ]

    for ext in ("*.wav", "*.mp3", "*.flac"):
        for sample in sorted(VOICES_DIR.glob(ext)):
            voices.append(
                {
                    "id": sample.stem,
                    "name": f"{sample.stem} (Cloned)",
                    "language": "en",
                    "accent": "Custom",
                    "engine": "chatterbox",
                    "description": f"Zero-shot voice clone from {sample.name}",
                }
            )
    return voices


@app.post("/tts")
def synthesize(req: TtsRequest):
    chunks = chunk_text(req.text)
    if not chunks:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    audio_prompt_path: Optional[str] = None
    if req.voice_id and req.voice_id != "default":
        for ext in (".wav", ".mp3", ".flac"):
            candidate = VOICES_DIR / f"{req.voice_id}{ext}"
            if candidate.exists():
                audio_prompt_path = str(candidate)
                break

    model = get_tts_model()
    wav_segments: list[torch.Tensor] = []

    with _tts_lock:
        for chunk in chunks:
            kwargs = {
                "exaggeration": max(0.0, min(1.5, req.exaggeration)),
                "cfg_weight": max(0.0, min(1.0, req.cfg_weight)),
            }
            if audio_prompt_path:
                kwargs["audio_prompt_path"] = audio_prompt_path

            wav = model.generate(chunk, **kwargs)
            if wav.dim() == 1:
                wav = wav.unsqueeze(0)
            wav_segments.append(wav.cpu())

    combined = torch.cat(wav_segments, dim=-1)
    sample_rate = getattr(model, "sr", 24000)
    duration_seconds = combined.shape[-1] / float(sample_rate)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_wav = Path(tmpdir) / "output.wav"
        tmp_mp3 = Path(tmpdir) / "output.mp3"
        torchaudio.save(str(tmp_wav), combined, sample_rate)
        encode_wav_to_mp3(tmp_wav, tmp_mp3, speed=req.speed)
        mp3_bytes = tmp_mp3.read_bytes()

    adjusted_duration = duration_seconds / max(0.5, min(2.0, req.speed))
    return Response(
        content=mp3_bytes,
        media_type="audio/mpeg",
        headers={
            "X-Audio-Duration": f"{adjusted_duration:.2f}",
            "X-Chunk-Count": str(len(chunks)),
        },
    )


@app.post("/stt")
async def transcribe(file: UploadFile = File(...), language: Optional[str] = Form(None)):
    suffix = Path(file.filename or "audio.mp3").suffix or ".mp3"
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")

    model = get_stt_model()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_audio = Path(tmpdir) / f"input{suffix}"
        tmp_audio.write_bytes(data)

        with _stt_lock:
            segments, info = model.transcribe(
                str(tmp_audio),
                language=language if language else None,
                beam_size=5,
            )
            text = " ".join(seg.text.strip() for seg in segments).strip()

    return {
        "text": text,
        "language": getattr(info, "language", language or "unknown"),
        "durationSeconds": round(float(getattr(info, "duration", 0.0)), 2),
    }
