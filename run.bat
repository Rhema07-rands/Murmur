@echo off
echo ====================================================
echo Starting Murmur (Full Stack)
echo ====================================================

echo [1/3] Starting Speech Worker (Chatterbox + Whisper)...
start "Murmur Speech Worker" cmd /k "cd /d c:\Users\derek\OneDrive\Desktop\MURMUR\Murmur.SpeechWorker && .venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8000"

timeout /t 2 /nobreak >nul

echo [2/3] Starting Backend API (ASP.NET Core)...
start "Murmur API" cmd /k "cd /d c:\Users\derek\OneDrive\Desktop\MURMUR\Murmur.API && dotnet run"

timeout /t 2 /nobreak >nul

echo [3/3] Starting Client UI (Vite + React)...
start "Murmur Client" cmd /k "cd /d c:\Users\derek\OneDrive\Desktop\MURMUR\Murmur.Client && npm.cmd run dev"

echo.
echo All services launched!
echo Client: http://localhost:5173
echo API:    http://localhost:5000
echo Worker: http://localhost:8000
echo.
pause
