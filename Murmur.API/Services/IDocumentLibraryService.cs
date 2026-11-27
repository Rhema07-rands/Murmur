using Murmur.API.Models;

namespace Murmur.API.Services;

public interface IDocumentLibraryService
{
    Task<IReadOnlyList<SavedDocumentSummary>> ListDocumentsAsync(string? folderName = null, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<string>> ListFoldersAsync(CancellationToken cancellationToken = default);
    Task<SavedDocumentDetail?> GetDocumentAsync(string id, CancellationToken cancellationToken = default);
    Task<SavedDocumentSummary> SaveDocumentAsync(SaveDocumentRequest request, CancellationToken cancellationToken = default);
    Task<bool> DeleteDocumentAsync(string id, CancellationToken cancellationToken = default);
}
