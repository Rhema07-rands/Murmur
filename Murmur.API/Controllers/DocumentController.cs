using Microsoft.AspNetCore.Mvc;
using Murmur.API.Models;
using Murmur.API.Services;

namespace Murmur.API.Controllers;

[ApiController]
[Route("api/documents")]
public sealed class DocumentController : ControllerBase
{
    private readonly IDocumentExtractionService _extractionService;
    private readonly long _maxUploadBytes;

    public DocumentController(
        IDocumentExtractionService extractionService,
        IConfiguration configuration)
    {
        _extractionService = extractionService;
        var maxMb = configuration.GetValue<long?>("Storage:MaxUploadSizeMb") ?? 50;
        _maxUploadBytes = maxMb * 1024L * 1024L;
    }

    [HttpPost("upload")]
    [RequestSizeLimit(52_428_800)]
    public async Task<ActionResult<DocumentUploadResponse>> Upload(
        IFormFile file,
        CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest(new { error = "Please select a non-empty .pdf or .epub file." });
        }

        if (file.Length > _maxUploadBytes)
        {
            return BadRequest(new { error = $"File exceeds the {_maxUploadBytes / (1024 * 1024)} MB size limit." });
        }

        try
        {
            var doc = await _extractionService.ExtractAsync(file, cancellationToken);
            return Ok(new DocumentUploadResponse(
                Id: doc.Id,
                FileName: doc.FileName,
                FileType: doc.FileType,
                Title: doc.Title,
                Author: doc.Author,
                TotalCharacters: doc.TotalCharacters,
                SectionCount: doc.Sections.Count,
                Sections: doc.Sections
            ));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpGet("{id}/text")]
    public ActionResult<ExtractedDocument> GetText(string id)
    {
        var doc = _extractionService.GetDocument(id);
        if (doc is null)
        {
            return NotFound(new { error = "Document not found or expired." });
        }
        return Ok(doc);
    }

    [HttpDelete("{id}")]
    public IActionResult Delete(string id)
    {
        if (!_extractionService.DeleteDocument(id))
        {
            return NotFound(new { error = "Document not found." });
        }
        return NoContent();
    }
}
