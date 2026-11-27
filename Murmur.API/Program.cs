using Microsoft.AspNetCore.Http.Features;
using Murmur.API.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 52_428_800; // 50 MB
});

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:5173", "http://127.0.0.1:5173"];

builder.Services.AddCors(options =>
{
    options.AddPolicy("MurmurCors", policy =>
    {
        policy.WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var workerBaseUrl = builder.Configuration["SpeechWorker:BaseUrl"] ?? "http://127.0.0.1:8000";

builder.Services.AddSingleton<IDocumentExtractionService, DocumentExtractionService>();
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
