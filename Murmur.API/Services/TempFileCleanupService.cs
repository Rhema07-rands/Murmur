namespace Murmur.API.Services;

public sealed class TempFileCleanupService : BackgroundService
{
    private readonly ISpeechService _speechService;
    private readonly IDocumentExtractionService _documentService;
    private readonly TimeSpan _ttl;
    private readonly ILogger<TempFileCleanupService> _logger;

    public TempFileCleanupService(
        ISpeechService speechService,
        IDocumentExtractionService documentService,
        IConfiguration configuration,
        ILogger<TempFileCleanupService> logger)
    {
        _speechService = speechService;
        _documentService = documentService;
        _logger = logger;

        var ttlMinutes = configuration.GetValue<int?>("Storage:FileTtlMinutes") ?? 120;
        _ttl = TimeSpan.FromMinutes(Math.Max(10, ttlMinutes));
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(15));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                _speechService.CleanupExpiredAudio(_ttl);
                _documentService.CleanupExpired(_ttl);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Error during temporary file cleanup");
            }
        }
    }
}
