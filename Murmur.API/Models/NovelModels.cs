namespace Murmur.API.Models;

public sealed record NovelSummary(
    string Id,
    string Title,
    string? Author,
    int TotalChapters,
    long TotalCharacters,
    int LastReadChapter,
    string? CoverColor,
    DateTime UploadedAtUtc
);

public sealed record NovelChapterSummary(
    int ChapterIndex,
    string Title,
    int CharacterCount
);

public sealed record NovelChapterDetail(
    string NovelId,
    int ChapterIndex,
    string Title,
    string Content,
    int CharacterCount,
    int TotalChapters
);

public sealed record NovelUploadResponse(
    string Id,
    string Title,
    string? Author,
    int TotalChapters,
    long TotalCharacters,
    string Message
);

public sealed record UpdateReadingProgressRequest(
    int ChapterIndex
);
