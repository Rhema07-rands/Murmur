using Microsoft.AspNetCore.Mvc;
using Murmur.API.Models;
using Murmur.API.Services;

namespace Murmur.API.Controllers;

[ApiController]
[Route("api/novels")]
public sealed class LightNovelController : ControllerBase
{
    private readonly ILightNovelService _novelService;
    private readonly IDocumentExtractionService _extractionService;

    public LightNovelController(ILightNovelService novelService, IDocumentExtractionService extractionService)
    {
        _novelService = novelService;
        _extractionService = extractionService;
    }

    [HttpPost("upload")]
    [RequestSizeLimit(200_000_000)] // 200 MB
    public async Task<ActionResult<NovelUploadResponse>> UploadNovel(
        IFormFile file,
        CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest(new { error = "Please upload an EPUB file." });
        }

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext is not ".epub")
        {
            return BadRequest(new { error = "Only .epub files are supported for Light Novels." });
        }

        try
        {
            var extracted = await _extractionService.ExtractAsync(file, cancellationToken);

            if (extracted.Sections.Count == 0)
            {
                return BadRequest(new { error = "No chapters could be extracted from this EPUB file." });
            }

            var result = await _novelService.UploadNovelAsync(
                extracted.Title,
                extracted.Author,
                extracted.Sections,
                cancellationToken);

            _extractionService.DeleteDocument(extracted.Id);

            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<NovelSummary>>> ListNovels(CancellationToken cancellationToken)
    {
        var novels = await _novelService.ListNovelsAsync(cancellationToken);
        return Ok(novels);
    }

    [HttpGet("{novelId}")]
    public async Task<ActionResult<NovelSummary>> GetNovel(string novelId, CancellationToken cancellationToken)
    {
        var novel = await _novelService.GetNovelAsync(novelId, cancellationToken);
        if (novel is null)
        {
            return NotFound(new { error = "Novel not found." });
        }
        return Ok(novel);
    }

    [HttpGet("{novelId}/chapters")]
    public async Task<ActionResult<IReadOnlyList<NovelChapterSummary>>> ListChapters(
        string novelId,
        CancellationToken cancellationToken)
    {
        var chapters = await _novelService.ListChaptersAsync(novelId, cancellationToken);
        return Ok(chapters);
    }

    [HttpGet("{novelId}/chapters/{chapterIndex:int}")]
    public async Task<ActionResult<NovelChapterDetail>> GetChapter(
        string novelId,
        int chapterIndex,
        CancellationToken cancellationToken)
    {
        var chapter = await _novelService.GetChapterAsync(novelId, chapterIndex, cancellationToken);
        if (chapter is null)
        {
            return NotFound(new { error = "Chapter not found." });
        }
        return Ok(chapter);
    }

    [HttpPut("{novelId}/progress")]
    public async Task<IActionResult> UpdateProgress(
        string novelId,
        [FromBody] UpdateReadingProgressRequest request,
        CancellationToken cancellationToken)
    {
        var updated = await _novelService.UpdateReadingProgressAsync(novelId, request.ChapterIndex, cancellationToken);
        if (!updated)
        {
            return NotFound(new { error = "Novel not found." });
        }
        return Ok(new { success = true, lastReadChapter = request.ChapterIndex });
    }

    [HttpDelete("{novelId}")]
    public async Task<IActionResult> DeleteNovel(string novelId, CancellationToken cancellationToken)
    {
        var deleted = await _novelService.DeleteNovelAsync(novelId, cancellationToken);
        if (!deleted)
        {
            return NotFound(new { error = "Novel not found." });
        }
        return NoContent();
    }
}
