using Microsoft.AspNetCore.Http.Features;
using Murmur.API.Services;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(10);
    options.Limits.RequestHeadersTimeout = TimeSpan.FromMinutes(10);
});

builder.Services.AddControllers();
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 52_428_800; // 50 MB
});

builder.Services.AddCors(options =>
{
    options.AddPolicy("MurmurCors", policy =>
    {
        policy.AllowAnyOrigin()
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var workerBaseUrl = builder.Configuration["SpeechWorker:BaseUrl"] ?? "http://127.0.0.1:8000";

builder.Services.AddSingleton<IDocumentExtractionService, DocumentExtractionService>();
builder.Services.AddSingleton<IAuthService, TiDbAuthService>();
builder.Services.AddSingleton<IDocumentLibraryService, TiDbDocumentLibraryService>();
builder.Services.AddSingleton<ILightNovelService, TiDbLightNovelService>();
builder.Services.AddHttpClient<ISpeechService, ChatterboxSpeechService>(client =>
{
    client.BaseAddress = new Uri(workerBaseUrl);
    client.Timeout = TimeSpan.FromMinutes(10);
});
builder.Services.AddHostedService<TempFileCleanupService>();

var app = builder.Build();

app.UseCors("MurmurCors");
app.MapControllers();
app.MapGet("/api/health", () => Results.Ok(new { status = "ok", app = "Murmur.API" }));

app.Run();
