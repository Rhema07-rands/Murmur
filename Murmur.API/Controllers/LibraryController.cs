using Microsoft.AspNetCore.Mvc;
using Murmur.API.Models;
using Murmur.API.Services;

namespace Murmur.API.Controllers;

[ApiController]
[Route("api/library")]
public sealed class LibraryController : ControllerBase
{
    private readonly IDocumentLibraryService _libraryService;
    private readonly IAuthService _authService;

    public LibraryController(IDocumentLibraryService libraryService, IAuthService authService)
    {
        _libraryService = libraryService;
        _authService = authService;
    }

    private string? GetCurrentUserId()
    {
        var authHeader = Request.Headers.Authorization.ToString();
        return _authService.ValidateTokenAndGetUserId(authHeader);
    }

    [HttpGet("documents")]
    public async Task<ActionResult<IReadOnlyList<SavedDocumentSummary>>> ListDocuments(
        [FromQuery] string? folder,
        CancellationToken cancellationToken)
    {
        var userId = GetCurrentUserId();
        var docs = await _libraryService.ListDocumentsAsync(folder, userId, cancellationToken);
        return Ok(docs);
    }

    [HttpGet("folders")]
    public async Task<ActionResult<IReadOnlyList<string>>> ListFolders(CancellationToken cancellationToken)
    {
        var userId = GetCurrentUserId();
        var folders = await _libraryService.ListFoldersAsync(userId, cancellationToken);
        return Ok(folders);
    }

    [HttpGet("documents/{id}")]
    public async Task<ActionResult<SavedDocumentDetail>> GetDocument(string id, CancellationToken cancellationToken)
    {
        var userId = GetCurrentUserId();
        var doc = await _libraryService.GetDocumentAsync(id, userId, cancellationToken);
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

        var userId = GetCurrentUserId();
        var saved = await _libraryService.SaveDocumentAsync(request, userId, cancellationToken);
        return Ok(saved);
    }

    [HttpDelete("documents/{id}")]
    public async Task<IActionResult> DeleteDocument(string id, CancellationToken cancellationToken)
    {
        var userId = GetCurrentUserId();
        var deleted = await _libraryService.DeleteDocumentAsync(id, userId, cancellationToken);
        if (!deleted)
        {
            return NotFound(new { error = "Saved document not found." });
        }
        return NoContent();
    }
}
