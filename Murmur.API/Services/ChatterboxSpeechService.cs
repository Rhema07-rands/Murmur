using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Murmur.API.Models;

namespace Murmur.API.Services;

public sealed class ChatterboxSpeechService : ISpeechService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<ChatterboxSpeechService> _logger;
    private readonly string _audioStoragePath;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public ChatterboxSpeechService(
        HttpClient httpClient,
        IConfiguration configuration,
        IWebHostEnvironment environment,
        ILogger<ChatterboxSpeechService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;

        var tempRoot = configuration["Storage:TempPath"] ?? "TempStorage";
        _audioStoragePath = Path.Combine(environment.ContentRootPath, tempRoot, "audio");
        Directory.CreateDirectory(_audioStoragePath);
    }

    public async Task<WorkerHealthResponse> GetHealthAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            using var response = await _httpClient.GetAsync("/health", cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return new WorkerHealthResponse(false, "Chatterbox", "unknown", false, false,
                    $"Speech worker returned HTTP {(int)response.StatusCode}");
            }

            var payload = await response.Content.ReadFromJsonAsync<WorkerHealthPayload>(JsonOptions, cancellationToken);
            return new WorkerHealthResponse(
                Available: true,
                Engine: "Chatterbox TTS + Faster-Whisper",
                Device: payload?.Device ?? "unknown",
                ChatterboxLoaded: payload?.ChatterboxLoaded ?? false,
                WhisperLoaded: payload?.WhisperLoaded ?? false
            );
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Speech worker health check failed");
            return new WorkerHealthResponse(false, "Chatterbox", "offline", false, false,
                "Local AI speech worker is not running. Start Murmur.SpeechWorker to enable AI voices.");
        }
    }

    public async Task<IReadOnlyList<VoiceOption>> GetVoicesAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            using var response = await _httpClient.GetAsync("/voices", cancellationToken);
            response.EnsureSuccessStatusCode();
            var voices = await response.Content.ReadFromJsonAsync<List<VoiceOption>>(JsonOptions, cancellationToken);
            return voices ?? [];
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not fetch voices from speech worker");
            return
            [
                new VoiceOption(
                    Id: "default",
                    Name: "Chatterbox Default",
                    Language: "en",
                    Accent: "Neutral",
                    Engine: "chatterbox",
                    Description: "Default neural voice (requires local Murmur.SpeechWorker)"
                )
            ];
        }
    }

    public async Task<SpeechGenerateResponse> GenerateSpeechAsync(
        SpeechGenerateRequest request,
        CancellationToken cancellationToken = default)
    {
        var audioId = Guid.NewGuid().ToString("N");
        var outputPath = Path.Combine(_audioStoragePath, $"{audioId}.mp3");

        using var response = await _httpClient.PostAsJsonAsync("/tts", new
        {
            text = request.Text,
            voice_id = request.VoiceId ?? "default",
            language = request.Language ?? "en",
            speed = request.Speed,
            exaggeration = request.Exaggeration,
            cfg_weight = request.CfgWeight
        }, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var errBody = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"AI speech generation failed: {errBody}");
        }

        var audioBytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        await File.WriteAllBytesAsync(outputPath, audioBytes, cancellationToken);

        double? durationSeconds = null;
        if (response.Headers.TryGetValues("X-Audio-Duration", out var durValues) &&
            double.TryParse(durValues.FirstOrDefault(), out var parsedDur))
        {
            durationSeconds = parsedDur;
        }

        var chunkCount = 1;
        if (response.Headers.TryGetValues("X-Chunk-Count", out var chunkValues) &&
            int.TryParse(chunkValues.FirstOrDefault(), out var parsedChunks))
        {
            chunkCount = parsedChunks;
        }

        return new SpeechGenerateResponse(
            AudioId: audioId,
            AudioUrl: $"/api/speech/audio/{audioId}",
            DownloadUrl: $"/api/speech/download/{audioId}",
            Format: "mp3",
            DurationSeconds: durationSeconds,
            ChunkCount: chunkCount
        );
    }

    public async Task<TranscriptionResponse> TranscribeAsync(
        IFormFile audioFile,
        string? language = null,
        CancellationToken cancellationToken = default)
    {
        using var form = new MultipartFormDataContent();
        await using var stream = audioFile.OpenReadStream();
        using var fileContent = new StreamContent(stream);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(
            string.IsNullOrWhiteSpace(audioFile.ContentType) ? "audio/mpeg" : audioFile.ContentType);

        form.Add(fileContent, "file", audioFile.FileName);
        if (!string.IsNullOrWhiteSpace(language))
        {
            form.Add(new StringContent(language), "language");
        }

        using var response = await _httpClient.PostAsync("/stt", form, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var errBody = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"Transcription failed: {errBody}");
        }

        var result = await response.Content.ReadFromJsonAsync<TranscriptionResponse>(JsonOptions, cancellationToken);
        return result ?? throw new InvalidOperationException("Empty transcription response from speech worker.");
    }

    public string? GetAudioFilePath(string audioId)
    {
        if (string.IsNullOrWhiteSpace(audioId) || !audioId.All(char.IsLetterOrDigit))
        {
            return null;
        }

        var path = Path.Combine(_audioStoragePath, $"{audioId}.mp3");
        return File.Exists(path) ? path : null;
    }

    public void CleanupExpiredAudio(TimeSpan maxAge)
    {
        if (!Directory.Exists(_audioStoragePath))
        {
            return;
        }

        var cutoff = DateTime.UtcNow - maxAge;
        foreach (var file in Directory.EnumerateFiles(_audioStoragePath, "*.mp3"))
        {
            try
            {
                if (File.GetCreationTimeUtc(file) < cutoff)
                {
                    File.Delete(file);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to delete expired audio file {File}", file);
            }
        }
    }

    private sealed record WorkerHealthPayload(
        string Status,
        string Device,
        bool ChatterboxLoaded,
        bool WhisperLoaded
    );
}
