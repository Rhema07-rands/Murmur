using Murmur.API.Models;

namespace Murmur.API.Services;

public interface ILightNovelService
{
    Task<NovelUploadResponse> UploadNovelAsync(string title, string? author, IReadOnlyList<DocumentSection> chapters, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<NovelSummary>> ListNovelsAsync(CancellationToken cancellationToken = default);
    Task<NovelSummary?> GetNovelAsync(string novelId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<NovelChapterSummary>> ListChaptersAsync(string novelId, CancellationToken cancellationToken = default);
    Task<NovelChapterDetail?> GetChapterAsync(string novelId, int chapterIndex, CancellationToken cancellationToken = default);
    Task<bool> UpdateReadingProgressAsync(string novelId, int chapterIndex, CancellationToken cancellationToken = default);
    Task<bool> DeleteNovelAsync(string novelId, CancellationToken cancellationToken = default);
}
