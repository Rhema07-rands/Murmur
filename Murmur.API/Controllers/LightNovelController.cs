using System.Collections.Concurrent;
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
    private readonly IAuthService _authService;

    // In-memory import jobs tracker
    private static readonly ConcurrentDictionary<string, NovelImportJobState> _importJobs = new();

    public LightNovelController(
        ILightNovelService novelService,
        IDocumentExtractionService extractionService,
        IAuthService authService)
    {
        _novelService = novelService;
        _extractionService = extractionService;
        _authService = authService;
    }

    private string? GetCurrentUserId()
    {
        var authHeader = Request.Headers.Authorization.ToString();
        return _authService.ValidateTokenAndGetUserId(authHeader);
    }

    [HttpPost("upload-job")]
    [RequestSizeLimit(200_000_000)] // 200 MB
    public async Task<ActionResult<NovelImportJobStatus>> StartUploadJob(
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

        var jobId = Guid.NewGuid().ToString("N");
        var userId = GetCurrentUserId();

        // Copy file into memory so background thread can process safely
        var memoryStream = new MemoryStream();
        await file.CopyToAsync(memoryStream, cancellationToken);
        memoryStream.Position = 0;
        var fileName = file.FileName;

        var jobState = new NovelImportJobState
        {
            JobId = jobId,
            Status = "processing",
            Stage = "dissecting",
            ProgressPercent = 5,
        };
        _importJobs[jobId] = jobState;

        // Background worker
        _ = Task.Run(async () =>
        {
            try
            {
                using (memoryStream)
                {
                    var formFile = new FormFile(memoryStream, 0, memoryStream.Length, "file", fileName);
                    var extracted = await _extractionService.ExtractAsync(formFile);

                    if (extracted.Sections.Count == 0)
                    {
                        jobState.Status = "failed";
                        jobState.Error = "No chapters could be extracted from this EPUB file.";
                        return;
                    }

                    jobState.Stage = "saving";
                    jobState.TotalChapters = extracted.Sections.Count;
                    jobState.Title = extracted.Title;
                    jobState.ProgressPercent = 20;

                    var res = await _novelService.UploadNovelAsync(
                        extracted.Title,
                        extracted.Author,
                        extracted.Sections,
                        userId,
                        onProgress: (processed, total) =>
                        {
                            jobState.ProcessedChapters = processed;
                            jobState.TotalChapters = total;
                            // Scale 20% -> 99%
                            jobState.ProgressPercent = 20 + (int)Math.Clamp(((double)processed / total) * 79, 0, 79);
                        });

                    _extractionService.DeleteDocument(extracted.Id);

                    jobState.Status = "completed";
                    jobState.Stage = "completed";
                    jobState.ProgressPercent = 100;
                    jobState.ProcessedChapters = extracted.Sections.Count;
                    jobState.NovelId = res.Id;
                }
            }
            catch (Exception ex)
            {
                jobState.Status = "failed";
                jobState.Error = ex.Message;
            }
        });

        return Ok(jobState.ToStatus());
    }

    [HttpGet("jobs/{jobId}")]
    public ActionResult<NovelImportJobStatus> GetJobStatus(string jobId)
    {
        if (_importJobs.TryGetValue(jobId, out var job))
        {
            return Ok(job.ToStatus());
        }
        return NotFound(new { error = "Import job not found or expired." });
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

            var userId = GetCurrentUserId();
            var result = await _novelService.UploadNovelAsync(
                extracted.Title,
                extracted.Author,
                extracted.Sections,
                userId,
                cancellationToken: cancellationToken);

            _extractionService.DeleteDocument(extracted.Id);

            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    private sealed class NovelImportJobState
    {
        public required string JobId { get; init; }
        public string Status { get; set; } = "processing";
        public string Stage { get; set; } = "dissecting";
        public int ProgressPercent { get; set; }
        public int ProcessedChapters { get; set; }
        public int TotalChapters { get; set; }
        public string? NovelId { get; set; }
        public string? Title { get; set; }
        public string? Error { get; set; }

        public NovelImportJobStatus ToStatus() => new(
            JobId,
            Status,
            ProgressPercent,
            Stage,
            ProcessedChapters,
            TotalChapters,
            NovelId,
            Title,
            Error
        );
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<NovelSummary>>> ListNovels(CancellationToken cancellationToken)
    {
        var userId = GetCurrentUserId();
        var novels = await _novelService.ListNovelsAsync(userId, cancellationToken);
        return Ok(novels);
    }

    [HttpGet("{novelId}")]
    public async Task<ActionResult<NovelSummary>> GetNovel(string novelId, CancellationToken cancellationToken)
    {
        var userId = GetCurrentUserId();
        var novel = await _novelService.GetNovelAsync(novelId, userId, cancellationToken);
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
        var userId = GetCurrentUserId();
        var deleted = await _novelService.DeleteNovelAsync(novelId, userId, cancellationToken);
        if (!deleted)
        {
            return NotFound(new { error = "Novel not found." });
        }
        return NoContent();
    }
}
