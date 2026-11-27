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

        // 1. If Chatterbox local voice is explicitly chosen and worker is reachable
        if (voiceId.StartsWith("chatterbox", StringComparison.OrdinalIgnoreCase) || voiceId == "default")
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
            await EdgeTtsClient.SynthesizeToFileAsync(request.Text, voiceId, "+0%", outputPath, cancellationToken);

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
