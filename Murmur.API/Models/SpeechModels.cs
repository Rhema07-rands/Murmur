namespace Murmur.API.Models;

public sealed record VoiceOption(
    string Id,
    string Name,
    string Language,
    string Accent,
    string Engine,
    string Description
);

public sealed record SpeechGenerateRequest(
    string Text,
    string? VoiceId = null,
    string? Language = "en",
    double Speed = 1.0,
    double Exaggeration = 0.5,
    double CfgWeight = 0.5
);

public sealed record SpeechGenerateResponse(
    string AudioId,
    string AudioUrl,
    string DownloadUrl,
    string Format,
    double? DurationSeconds,
    int ChunkCount
);

public sealed record TranscriptionResponse(
    string Text,
    string Language,
    double DurationSeconds
);

public sealed record WorkerHealthResponse(
    bool Available,
    string Engine,
    string Device,
    bool ChatterboxLoaded,
    bool WhisperLoaded,
    string? Error = null
);
