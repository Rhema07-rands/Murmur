using Murmur.API.Models;

namespace Murmur.API.Services;

public interface IDocumentLibraryService
{
    Task<IReadOnlyList<SavedDocumentSummary>> ListDocumentsAsync(string? folderName = null, string? userId = null, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<string>> ListFoldersAsync(string? userId = null, CancellationToken cancellationToken = default);
    Task<SavedDocumentDetail?> GetDocumentAsync(string id, string? userId = null, CancellationToken cancellationToken = default);
    Task<SavedDocumentSummary> SaveDocumentAsync(SaveDocumentRequest request, string? userId = null, CancellationToken cancellationToken = default);
    Task<bool> DeleteDocumentAsync(string id, string? userId = null, CancellationToken cancellationToken = default);
}
