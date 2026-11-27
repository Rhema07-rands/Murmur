import torch
print(f"PyTorch {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
else:
    print("Device: CPU")

import fastapi
print(f"FastAPI {fastapi.__version__}")

from faster_whisper import WhisperModel
print("faster-whisper: OK")

from chatterbox.tts import ChatterboxTTS
print("chatterbox-tts: OK")

print("\nAll imports successful!")
