using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using Murmur.API.Models;
using UglyToad.PdfPig;
using UglyToad.PdfPig.DocumentLayoutAnalysis.TextExtractor;
using VersOne.Epub;

namespace Murmur.API.Services;

public sealed partial class DocumentExtractionService : IDocumentExtractionService
{
    private readonly ConcurrentDictionary<string, ExtractedDocument> _documents = new();
    private readonly ILogger<DocumentExtractionService> _logger;

    public DocumentExtractionService(ILogger<DocumentExtractionService> logger)
    {
        _logger = logger;
    }

    public async Task<ExtractedDocument> ExtractAsync(IFormFile file, CancellationToken cancellationToken = default)
    {
        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (extension is not ".pdf" and not ".epub")
        {
            throw new InvalidOperationException("Unsupported file type. Only .pdf and .epub files are supported.");
        }

        using var memoryStream = new MemoryStream();
        await file.CopyToAsync(memoryStream, cancellationToken);
        memoryStream.Position = 0;

        var extracted = extension == ".pdf"
            ? ExtractPdf(file.FileName, memoryStream)
            : ExtractEpub(file.FileName, memoryStream);

        if (extracted.TotalCharacters == 0)
        {
            throw new InvalidOperationException(
                extension == ".pdf"
                    ? "No extractable text was found in this PDF. It may be a scanned image-only PDF."
                    : "No readable text was found in this EPUB file."
            );
        }

        _documents[extracted.Id] = extracted;
        return extracted;
    }

    public ExtractedDocument? GetDocument(string id) =>
        _documents.TryGetValue(id, out var doc) ? doc : null;

    public bool DeleteDocument(string id) =>
        _documents.TryRemove(id, out _);

    public void CleanupExpired(TimeSpan maxAge)
    {
        var cutoff = DateTime.UtcNow - maxAge;
        foreach (var kvp in _documents)
        {
            if (kvp.Value.CreatedAtUtc < cutoff)
            {
                _documents.TryRemove(kvp.Key, out _);
            }
        }
    }

    private ExtractedDocument ExtractPdf(string fileName, Stream stream)
    {
        try
        {
            using var pdf = PdfDocument.Open(stream);
            var sections = new List<DocumentSection>();
            var fullTextBuilder = new StringBuilder();

            var pageNumber = 0;
            foreach (var page in pdf.GetPages())
            {
                pageNumber++;
                var rawText = ContentOrderTextExtractor.GetText(page);
                var cleaned = NormalizeWhitespace(rawText);
                if (string.IsNullOrWhiteSpace(cleaned))
                {
                    continue;
                }

                sections.Add(new DocumentSection(
                    Index: sections.Count + 1,
                    Title: $"Page {pageNumber}",
                    Content: cleaned,
                    CharacterCount: cleaned.Length
                ));

                if (fullTextBuilder.Length > 0)
                {
                    fullTextBuilder.AppendLine().AppendLine();
                }
                fullTextBuilder.Append(cleaned);
            }

            var title = !string.IsNullOrWhiteSpace(pdf.Information?.Title)
                ? pdf.Information.Title.Trim()
                : Path.GetFileNameWithoutExtension(fileName);
            var author = string.IsNullOrWhiteSpace(pdf.Information?.Author)
                ? null
                : pdf.Information.Author.Trim();

            var fullText = fullTextBuilder.ToString();
            return new ExtractedDocument(
                Id: Guid.NewGuid().ToString("N"),
                FileName: fileName,
                FileType: "pdf",
                Title: title,
                Author: author,
                FullText: fullText,
                TotalCharacters: fullText.Length,
                Sections: sections,
                CreatedAtUtc: DateTime.UtcNow
            );
        }
        catch (Exception ex) when (ex is not InvalidOperationException)
        {
            _logger.LogWarning(ex, "Failed to parse PDF {FileName}", fileName);
            throw new InvalidOperationException("The uploaded PDF file appears to be corrupted or unreadable.", ex);
        }
    }

    private ExtractedDocument ExtractEpub(string fileName, Stream stream)
    {
        try
        {
            var book = EpubReader.ReadBook(stream);
            var navTitles = BuildNavigationTitleMap(book.Navigation);

            var sections = new List<DocumentSection>();
            var fullTextBuilder = new StringBuilder();

            var htmlFiles = book.ReadingOrder.Count > 0
                ? book.ReadingOrder
                : book.Content.Html.Local.ToList();

            foreach (var htmlFile in htmlFiles)
            {
                var plainText = StripHtmlToText(htmlFile.Content);
                if (string.IsNullOrWhiteSpace(plainText))
                {
                    continue;
                }

                var chapterTitle = navTitles.TryGetValue(htmlFile.FilePath, out var navTitle)
                    ? navTitle
                    : ExtractHtmlTitle(htmlFile.Content) ?? $"Chapter {sections.Count + 1}";

                sections.Add(new DocumentSection(
                    Index: sections.Count + 1,
                    Title: chapterTitle,
                    Content: plainText,
                    CharacterCount: plainText.Length
                ));

                if (fullTextBuilder.Length > 0)
                {
                    fullTextBuilder.AppendLine().AppendLine();
                }
                fullTextBuilder.Append(plainText);
            }

            var title = !string.IsNullOrWhiteSpace(book.Title)
                ? book.Title.Trim()
                : Path.GetFileNameWithoutExtension(fileName);
            var author = book.AuthorList.Count > 0
                ? string.Join(", ", book.AuthorList)
                : (string.IsNullOrWhiteSpace(book.Author) ? null : book.Author.Trim());

            var fullText = fullTextBuilder.ToString();
            return new ExtractedDocument(
                Id: Guid.NewGuid().ToString("N"),
                FileName: fileName,
                FileType: "epub",
                Title: title,
                Author: author,
                FullText: fullText,
                TotalCharacters: fullText.Length,
                Sections: sections,
                CreatedAtUtc: DateTime.UtcNow
            );
        }
        catch (Exception ex) when (ex is not InvalidOperationException)
        {
            _logger.LogWarning(ex, "Failed to parse EPUB {FileName}", fileName);
            throw new InvalidOperationException("The uploaded EPUB file appears to be corrupted or unreadable.", ex);
        }
    }

    private static Dictionary<string, string> BuildNavigationTitleMap(IEnumerable<EpubNavigationItem>? navItems)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (navItems is null)
        {
            return map;
        }

        void Walk(IEnumerable<EpubNavigationItem> items)
        {
            foreach (var item in items)
            {
                var filePath = item.Link?.ContentFilePath;
                if (!string.IsNullOrWhiteSpace(filePath) && !string.IsNullOrWhiteSpace(item.Title))
                {
                    map.TryAdd(filePath, item.Title.Trim());
                }
                if (item.NestedItems is { Count: > 0 })
                {
                    Walk(item.NestedItems);
                }
            }
        }

        Walk(navItems);
        return map;
    }

    private static string? ExtractHtmlTitle(string html)
    {
        var match = TitleRegex().Match(html);
        if (!match.Success)
        {
            return null;
        }
        var decoded = WebUtility.HtmlDecode(TagRegex().Replace(match.Groups[1].Value, " ")).Trim();
        return string.IsNullOrWhiteSpace(decoded) ? null : decoded;
    }

    private static string StripHtmlToText(string html)
    {
        var withoutScripts = ScriptStyleRegex().Replace(html, " ");
        var withBreaks = BlockTagRegex().Replace(withoutScripts, "\n");
        var withoutTags = TagRegex().Replace(withBreaks, " ");
        var decoded = WebUtility.HtmlDecode(withoutTags);
        return NormalizeWhitespace(decoded);
    }

    private static string NormalizeWhitespace(string input)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return string.Empty;
        }

        var lines = input
            .Replace("\r\n", "\n")
            .Replace('\r', '\n')
            .Split('\n')
            .Select(line => MultiSpaceRegex().Replace(line, " ").Trim())
            .Where(line => line.Length > 0);

        return string.Join("\n", lines);
    }

    [GeneratedRegex(@"<(script|style)[^>]*>[\s\S]*?</\1>", RegexOptions.IgnoreCase)]
    private static partial Regex ScriptStyleRegex();

    [GeneratedRegex(@"</?(p|div|br|li|h[1-6]|tr|blockquote|section|article)[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex BlockTagRegex();

    [GeneratedRegex(@"<[^>]+>")]
    private static partial Regex TagRegex();

    [GeneratedRegex(@"<h1[^>]*>([\s\S]*?)</h1>|<title[^>]*>([\s\S]*?)</title>", RegexOptions.IgnoreCase)]
    private static partial Regex TitleRegex();

    [GeneratedRegex(@"[ \t]{2,}")]
    private static partial Regex MultiSpaceRegex();
}
