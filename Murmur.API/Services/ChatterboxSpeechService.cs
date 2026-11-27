using System.Collections.Concurrent;
using System.Diagnostics;
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
    private static readonly ConcurrentDictionary<string, SpeechJobState> _jobs = new();

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static readonly IReadOnlyList<VoiceOption> DefaultNeuralVoices =
    [
        new("en-US-JennyNeural", "Jenny (US Neural)", "en-US", "United States", "cloud-neural", "Warm, natural US English female neural voice"),
        new("en-US-GuyNeural", "Guy (US Neural)", "en-US", "United States", "cloud-neural", "Clear, natural US English male neural voice"),
        new("en-US-AriaNeural", "Aria (US Expressive)", "en-US", "United States", "cloud-neural", "Expressive US English female neural voice"),
        new("en-US-ChristopherNeural", "Christopher (US Casual)", "en-US", "United States", "cloud-neural", "Casual, friendly US English male neural voice"),
        new("en-GB-SoniaNeural", "Sonia (UK Neural)", "en-GB", "United Kingdom", "cloud-neural", "Polished British English female neural voice"),
        new("en-GB-RyanNeural", "Ryan (UK Neural)", "en-GB", "United Kingdom", "cloud-neural", "Friendly British English male neural voice"),
        new("en-AU-NatashaNeural", "Natasha (AU Neural)", "en-AU", "Australia", "cloud-neural", "Natural Australian English female neural voice"),
        new("es-ES-ElviraNeural", "Elvira (Spanish Neural)", "es-ES", "Spain", "cloud-neural", "Natural Castilian Spanish female voice"),
        new("fr-FR-DeniseNeural", "Denise (French Neural)", "fr-FR", "France", "cloud-neural", "Standard French female neural voice"),
        new("de-DE-KatjaNeural", "Katja (German Neural)", "de-DE", "Germany", "cloud-neural", "Natural German female neural voice"),
        new("ja-JP-NanamiNeural", "Nanami (Japanese Neural)", "ja-JP", "Japan", "cloud-neural", "Standard Japanese female neural voice")
    ];

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
            if (response.IsSuccessStatusCode)
            {
                var payload = await response.Content.ReadFromJsonAsync<WorkerHealthPayload>(JsonOptions, cancellationToken);
                return new WorkerHealthResponse(
                    Available: true,
                    Engine: "Local Chatterbox (GPU) + Cloud Neural",
                    Device: payload?.Device ?? "cuda",
                    ChatterboxLoaded: payload?.ChatterboxLoaded ?? true,
                    WhisperLoaded: payload?.WhisperLoaded ?? true
                );
            }
        }
        catch (Exception)
        {
            // Cloud Neural is primary
        }

        return new WorkerHealthResponse(
            Available: true,
            Engine: "Cloud Neural AI (Online)",
            Device: "Cloud Service",
            ChatterboxLoaded: false,
            WhisperLoaded: false
        );
    }

    public async Task<IReadOnlyList<VoiceOption>> GetVoicesAsync(CancellationToken cancellationToken = default)
    {
        var result = new List<VoiceOption>(DefaultNeuralVoices);

        try
        {
            using var response = await _httpClient.GetAsync("/voices", cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                var localVoices = await response.Content.ReadFromJsonAsync<List<VoiceOption>>(JsonOptions, cancellationToken);
                if (localVoices is { Count: > 0 })
                {
                    result.AddRange(localVoices);
                }
            }
        }
        catch (Exception)
        {
            // Default to cloud voices
        }

        return result;
    }

    public async Task<SpeechGenerateResponse> GenerateSpeechAsync(
        SpeechGenerateRequest request,
        CancellationToken cancellationToken = default)
    {
        var audioId = Guid.NewGuid().ToString("N");
        var outputPath = Path.Combine(_audioStoragePath, $"{audioId}.mp3");

        var voiceId = string.IsNullOrWhiteSpace(request.VoiceId) ? "en-US-JennyNeural" : request.VoiceId;

        // 1. If user chose a local Chatterbox voice (built-in "default" or any custom cloned voice in voices/), use the local worker
        var isCloudNeuralVoice = DefaultNeuralVoices.Any(v =>
            v.Id.Equals(voiceId, StringComparison.OrdinalIgnoreCase));

        if (!isCloudNeuralVoice)
        {
            try
            {
                using var response = await _httpClient.PostAsJsonAsync("/tts", new
                {
                    text = request.Text,
                    voice_id = voiceId,
                    language = request.Language ?? "en",
                    speed = request.Speed,
                    exaggeration = request.Exaggeration,
                    cfg_weight = request.CfgWeight
                }, cancellationToken);

                if (response.IsSuccessStatusCode)
                {
                    var audioBytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
                    await File.WriteAllBytesAsync(outputPath, audioBytes, cancellationToken);

                    return new SpeechGenerateResponse(
                        AudioId: audioId,
                        AudioUrl: $"/api/speech/audio/{audioId}",
                        DownloadUrl: $"/api/speech/download/{audioId}",
                        Format: "mp3",
                        DurationSeconds: null,
                        ChunkCount: 1
                    );
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Local Chatterbox worker unavailable, falling back to Cloud Neural TTS.");
                voiceId = "en-US-JennyNeural";
            }
        }

        // 2. Generate using authenticated Cloud Neural TTS (speed is applied cleanly on client playbackRate 0.5x-3x)
        try
        {
            await EdgeTtsClient.SynthesizeToFileAsync(request.Text, voiceId, "+0%", outputPath, onProgress: null, cancellationToken);

            return new SpeechGenerateResponse(
                AudioId: audioId,
                AudioUrl: $"/api/speech/audio/{audioId}",
                DownloadUrl: $"/api/speech/download/{audioId}",
                Format: "mp3",
                DurationSeconds: null,
                ChunkCount: 1
            );
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Cloud Neural TTS generation failed");
            throw new InvalidOperationException($"Neural speech generation failed: {ex.Message}", ex);
        }
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

    public SpeechJobStatus StartSpeechJob(SpeechGenerateRequest request)
    {
        var jobId = Guid.NewGuid().ToString("N");
        var audioId = Guid.NewGuid().ToString("N");
        var outputPath = Path.Combine(_audioStoragePath, $"{audioId}.mp3");
        var totalChars = request.Text.Length;
        var estChunks = Math.Max(1, (int)Math.Ceiling(totalChars / 5000.0));
        // Estimate ~3.5 seconds per chunk
        var initialEta = Math.Max(2, estChunks * 3);

        var state = new SpeechJobState
        {
            JobId = jobId,
            AudioId = audioId,
            OutputPath = outputPath,
            Request = request,
            TotalCharacters = totalChars,
            TotalChunks = estChunks,
            EstimatedSecondsRemaining = initialEta,
            Status = "queued"
        };

        _jobs[jobId] = state;

        _ = Task.Run(async () =>
        {
            state.Status = "processing";
            state.Stopwatch.Start();

            var voiceId = string.IsNullOrWhiteSpace(request.VoiceId) ? "en-US-JennyNeural" : request.VoiceId;
            var isCloudNeuralVoice = DefaultNeuralVoices.Any(v =>
                v.Id.Equals(voiceId, StringComparison.OrdinalIgnoreCase));

            try
            {
                if (!isCloudNeuralVoice)
                {
                    // Chatterbox local voice
                    try
                    {
                        using var response = await _httpClient.PostAsJsonAsync("/tts", new
                        {
                            text = request.Text,
                            voice_id = voiceId,
                            language = request.Language ?? "en",
                            speed = request.Speed,
                            exaggeration = request.Exaggeration,
                            cfg_weight = request.CfgWeight
                        }, state.Cts.Token);

                        if (response.IsSuccessStatusCode)
                        {
                            var audioBytes = await response.Content.ReadAsByteArrayAsync(state.Cts.Token);
                            await File.WriteAllBytesAsync(outputPath, audioBytes, state.Cts.Token);

                            state.Status = "completed";
                            state.ProgressPercent = 100;
                            state.ProcessedCharacters = totalChars;
                            state.CurrentChunk = estChunks;
                            state.EstimatedSecondsRemaining = 0;
                            state.AudioUrl = $"/api/speech/audio/{audioId}";
                            state.DownloadUrl = $"/api/speech/download/{audioId}";
                            return;
                        }
                    }
                    catch (Exception ex) when (!state.Cts.IsCancellationRequested)
                    {
                        _logger.LogWarning(ex, "Local Chatterbox worker unavailable in job, falling back to Cloud Neural TTS.");
                        voiceId = "en-US-JennyNeural";
                    }
                }

                // Cloud Neural TTS streaming with live progress
                await EdgeTtsClient.SynthesizeToFileAsync(
                    request.Text,
                    voiceId,
                    "+0%",
                    outputPath,
                    onProgress: (curChunk, totalC, procChars, totalCChars) =>
                    {
                        state.CurrentChunk = curChunk;
                        state.TotalChunks = totalC;
                        state.ProcessedCharacters = procChars;
                        state.TotalCharacters = totalCChars;
                        state.ProgressPercent = (int)Math.Clamp((double)procChars / totalCChars * 100, 0, 99);

                        var elapsed = state.Stopwatch.Elapsed.TotalSeconds;
                        if (elapsed > 0.5 && procChars > 0)
                        {
                            var charsPerSec = procChars / elapsed;
                            var remainingChars = totalCChars - procChars;
                            state.EstimatedSecondsRemaining = (int)Math.Max(1, Math.Ceiling(remainingChars / charsPerSec));
                        }
                    },
                    state.Cts.Token);

                state.Status = "completed";
                state.ProgressPercent = 100;
                state.ProcessedCharacters = totalChars;
                state.CurrentChunk = state.TotalChunks;
                state.EstimatedSecondsRemaining = 0;
                state.AudioUrl = $"/api/speech/audio/{audioId}";
                state.DownloadUrl = $"/api/speech/download/{audioId}";
            }
            catch (OperationCanceledException)
            {
                state.Status = "cancelled";
                try { if (File.Exists(outputPath)) File.Delete(outputPath); } catch { }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Background speech generation job {JobId} failed", jobId);
                state.Status = "failed";
                state.Error = ex.Message;
                try { if (File.Exists(outputPath)) File.Delete(outputPath); } catch { }
            }
            finally
            {
                state.Stopwatch.Stop();
            }
        });

        return state.ToStatus();
    }

    public SpeechJobStatus? GetSpeechJob(string jobId)
    {
        return _jobs.TryGetValue(jobId, out var state) ? state.ToStatus() : null;
    }

    public bool CancelSpeechJob(string jobId)
    {
        if (_jobs.TryGetValue(jobId, out var state))
        {
            state.Cts.Cancel();
            state.Status = "cancelled";
            return true;
        }
        return false;
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

        // Clean up expired jobs
        foreach (var (id, job) in _jobs)
        {
            if (job.CreatedAt < cutoff)
            {
                _jobs.TryRemove(id, out _);
            }
        }
    }

    private sealed class SpeechJobState
    {
        public required string JobId { get; init; }
        public required string AudioId { get; init; }
        public required string OutputPath { get; init; }
        public required SpeechGenerateRequest Request { get; init; }
        public string Status { get; set; } = "queued";
        public int ProgressPercent { get; set; }
        public int CurrentChunk { get; set; }
        public int TotalChunks { get; set; } = 1;
        public int ProcessedCharacters { get; set; }
        public int TotalCharacters { get; set; }
        public int EstimatedSecondsRemaining { get; set; }
        public string? AudioUrl { get; set; }
        public string? DownloadUrl { get; set; }
        public string? Error { get; set; }
        public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
        public Stopwatch Stopwatch { get; } = new();
        public CancellationTokenSource Cts { get; } = new();

        public SpeechJobStatus ToStatus() => new(
            JobId: JobId,
            Status: Status,
            ProgressPercent: ProgressPercent,
            CurrentChunk: CurrentChunk,
            TotalChunks: TotalChunks,
            ProcessedCharacters: ProcessedCharacters,
            TotalCharacters: TotalCharacters,
            EstimatedSecondsRemaining: EstimatedSecondsRemaining,
            AudioId: AudioId,
            AudioUrl: AudioUrl,
            DownloadUrl: DownloadUrl,
            Error: Error
        );
    }

    private sealed record WorkerHealthPayload(
        string Status,
        string Device,
        bool ChatterboxLoaded,
        bool WhisperLoaded
    );
}
