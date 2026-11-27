using Microsoft.AspNetCore.Mvc;
using Murmur.API.Models;
using Murmur.API.Services;

namespace Murmur.API.Controllers;

[ApiController]
[Route("api/library")]
public sealed class LibraryController : ControllerBase
{
    private readonly IDocumentLibraryService _libraryService;

    public LibraryController(IDocumentLibraryService libraryService)
    {
        _libraryService = libraryService;
    }

    [HttpGet("documents")]
    public async Task<ActionResult<IReadOnlyList<SavedDocumentSummary>>> ListDocuments(
        [FromQuery] string? folder,
        CancellationToken cancellationToken)
    {
        var docs = await _libraryService.ListDocumentsAsync(folder, cancellationToken);
        return Ok(docs);
    }

    [HttpGet("folders")]
    public async Task<ActionResult<IReadOnlyList<string>>> ListFolders(CancellationToken cancellationToken)
    {
        var folders = await _libraryService.ListFoldersAsync(cancellationToken);
        return Ok(folders);
    }

    [HttpGet("documents/{id}")]
    public async Task<ActionResult<SavedDocumentDetail>> GetDocument(string id, CancellationToken cancellationToken)
    {
        var doc = await _libraryService.GetDocumentAsync(id, cancellationToken);
        if (doc is null)
        {
            return NotFound(new { error = "Saved document not found." });
        }
        return Ok(doc);
    }

    [HttpPost("documents")]
    public async Task<ActionResult<SavedDocumentSummary>> SaveDocument(
        [FromBody] SaveDocumentRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Content))
        {
            return BadRequest(new { error = "Cannot save an empty document." });
        }

        var saved = await _libraryService.SaveDocumentAsync(request, cancellationToken);
        return Ok(saved);
    }

    [HttpDelete("documents/{id}")]
    public async Task<IActionResult> DeleteDocument(string id, CancellationToken cancellationToken)
    {
        var deleted = await _libraryService.DeleteDocumentAsync(id, cancellationToken);
        if (!deleted)
        {
            return NotFound(new { error = "Saved document not found." });
        }
        return NoContent();
    }
}
