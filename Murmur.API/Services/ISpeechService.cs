using Murmur.API.Models;

namespace Murmur.API.Services;

public interface ISpeechService
{
    Task<WorkerHealthResponse> GetHealthAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<VoiceOption>> GetVoicesAsync(CancellationToken cancellationToken = default);
    Task<SpeechGenerateResponse> GenerateSpeechAsync(SpeechGenerateRequest request, CancellationToken cancellationToken = default);
    Task<TranscriptionResponse> TranscribeAsync(IFormFile audioFile, string? language = null, CancellationToken cancellationToken = default);
    string? GetAudioFilePath(string audioId);
    void CleanupExpiredAudio(TimeSpan maxAge);
}
