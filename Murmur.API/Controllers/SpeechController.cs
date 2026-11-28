using Microsoft.AspNetCore.Mvc;
using Murmur.API.Models;
using Murmur.API.Services;

namespace Murmur.API.Controllers;

[ApiController]
[Route("api/speech")]
public sealed class SpeechController : ControllerBase
{
    private readonly ISpeechService _speechService;

    public SpeechController(ISpeechService speechService)
    {
        _speechService = speechService;
    }

    [HttpGet("health")]
    public async Task<ActionResult<WorkerHealthResponse>> GetHealth(CancellationToken cancellationToken)
    {
        var health = await _speechService.GetHealthAsync(cancellationToken);
        return Ok(health);
    }

    [HttpGet("voices")]
    public async Task<ActionResult<IReadOnlyList<VoiceOption>>> GetVoices(CancellationToken cancellationToken)
    {
        var voices = await _speechService.GetVoicesAsync(cancellationToken);
        return Ok(voices);
    }

    [HttpPost("generate")]
    public async Task<ActionResult<SpeechGenerateResponse>> Generate(
        [FromBody] SpeechGenerateRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Text))
        {
            return BadRequest(new { error = "Text cannot be empty." });
        }

        if (request.Text.Length > 500_000)
        {
            return BadRequest(new { error = "Text exceeds the 500,000 character limit per request. Please select fewer sections." });
        }

        try
        {
            var result = await _speechService.GenerateSpeechAsync(request, cancellationToken);
            return Ok(result);
        }
        catch (HttpRequestException)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                error = "Local AI speech worker is unavailable. Make sure Murmur.SpeechWorker is running, or use Browser Speech."
            });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("generate-job")]
    public ActionResult<SpeechJobStatus> GenerateJob([FromBody] SpeechGenerateRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Text))
        {
            return BadRequest(new { error = "Text cannot be empty." });
        }

        if (request.Text.Length > 500_000)
        {
            return BadRequest(new { error = "Text exceeds the 500,000 character limit per request. Please select fewer sections." });
        }

        var job = _speechService.StartSpeechJob(request);
        return Ok(job);
    }

    [HttpGet("job/{jobId}")]
    public ActionResult<SpeechJobStatus> GetJobStatus(string jobId)
    {
        var job = _speechService.GetSpeechJob(jobId);
        if (job is null)
        {
            return NotFound(new { error = "Speech job was not found or has expired." });
        }

        return Ok(job);
    }

    [HttpPost("job/{jobId}/cancel")]
    public IActionResult CancelJob(string jobId)
    {
        var success = _speechService.CancelSpeechJob(jobId);
        return Ok(new { success });
    }

    [HttpGet("audio/{id}")]
    public IActionResult GetAudio(string id)
    {
        var path = _speechService.GetAudioFilePath(id);
        if (path is null)
        {
            return NotFound(new { error = "Generated audio file was not found or has expired." });
        }

        return PhysicalFile(path, "audio/mpeg", enableRangeProcessing: true);
    }

    [HttpGet("download/{id}")]
    public IActionResult DownloadAudio(string id)
    {
        var path = _speechService.GetAudioFilePath(id);
        if (path is null)
        {
            return NotFound(new { error = "Generated audio file was not found or has expired." });
        }

        return PhysicalFile(path, "audio/mpeg", $"murmur-{id[..Math.Min(8, id.Length)]}.mp3");
    }

    [HttpPost("transcribe")]
    [RequestSizeLimit(52_428_800)]
    public async Task<ActionResult<TranscriptionResponse>> Transcribe(
        IFormFile file,
        [FromForm] string? language,
        CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest(new { error = "Please upload a non-empty audio file." });
        }

        try
        {
            var result = await _speechService.TranscribeAsync(file, language, cancellationToken);
            return Ok(result);
        }
        catch (HttpRequestException)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                error = "Local AI speech worker is unavailable. Start Murmur.SpeechWorker to use Faster-Whisper transcription."
            });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}
