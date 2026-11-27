namespace Murmur.API.Models;

public sealed record DocumentSection(
    int Index,
    string Title,
    string Content,
    int CharacterCount
);

public sealed record ExtractedDocument(
    string Id,
    string FileName,
    string FileType,
    string Title,
    string? Author,
    string FullText,
    int TotalCharacters,
    IReadOnlyList<DocumentSection> Sections,
    DateTime CreatedAtUtc
);

public sealed record DocumentUploadResponse(
    string Id,
    string FileName,
    string FileType,
    string Title,
    string? Author,
    int TotalCharacters,
    int SectionCount,
    IReadOnlyList<DocumentSection> Sections
);
