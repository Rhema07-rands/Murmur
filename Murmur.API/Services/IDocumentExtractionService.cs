using Murmur.API.Models;

namespace Murmur.API.Services;

public interface IDocumentExtractionService
{
    Task<ExtractedDocument> ExtractAsync(IFormFile file, CancellationToken cancellationToken = default);
    ExtractedDocument? GetDocument(string id);
    bool DeleteDocument(string id);
    void CleanupExpired(TimeSpan maxAge);
}
