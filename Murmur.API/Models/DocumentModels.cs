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

public sealed record SaveDocumentRequest(
    string Title,
    string FolderName,
    string Content,
    string? FileType = "text"
);

public sealed record SavedDocumentSummary(
    string Id,
    string FolderName,
    string Title,
    string FileType,
    int CharacterCount,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc
);

public sealed record SavedDocumentDetail(
    string Id,
    string FolderName,
    string Title,
    string FileType,
    string Content,
    int CharacterCount,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc
);
