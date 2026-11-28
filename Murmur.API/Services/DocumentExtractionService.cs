using System.Collections.Concurrent;
using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
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
        if (extension is not ".pdf" and not ".epub" and not ".docx")
        {
            throw new InvalidOperationException("Unsupported file type. Only .pdf, .epub, and .docx files are supported.");
        }

        using var memoryStream = new MemoryStream();
        await file.CopyToAsync(memoryStream, cancellationToken);
        memoryStream.Position = 0;

        var extracted = extension switch
        {
            ".pdf" => ExtractPdf(file.FileName, memoryStream),
            ".epub" => ExtractEpub(file.FileName, memoryStream),
            ".docx" => ExtractDocx(file.FileName, memoryStream),
            _ => throw new InvalidOperationException("Unsupported file format.")
        };

        if (extracted.TotalCharacters == 0)
        {
            throw new InvalidOperationException(
                extension switch
                {
                    ".pdf" => "No extractable text was found in this PDF. It may be a scanned image-only PDF.",
                    ".epub" => "No readable text was found in this EPUB file.",
                    ".docx" => "No readable text was found in this Word (.docx) file.",
                    _ => "No readable text found."
                }
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
        // 1. First attempt with VersOne.Epub
        try
        {
            var initialPosition = stream.Position;
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

            if (sections.Count > 0)
            {
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
        }
        catch (Exception ex)
        {
            _logger.LogInformation(ex, "VersOne.Epub could not parse {FileName}, falling back to built-in ZipArchive OPF/NCX parser.", fileName);
        }

        // 2. Direct ZipArchive OPF / NCX parser fallback (supports massive webnovels / Ag2S / Calibre formats)
        try
        {
            stream.Position = 0;
            using var zip = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true);

            // Locate container.xml to find root OPF
            var containerEntry = zip.GetEntry("META-INF/container.xml");
            string? opfPath = null;
            if (containerEntry != null)
            {
                using var cs = containerEntry.Open();
                var cDoc = XDocument.Load(cs);
                XNamespace cNs = "urn:oasis:names:tc:opendocument:xmlns:container";
                opfPath = cDoc.Descendants(cNs + "rootfile")
                    .FirstOrDefault()?.Attribute("full-path")?.Value;
            }

            var opfEntry = (!string.IsNullOrWhiteSpace(opfPath) ? zip.GetEntry(opfPath) : null)
                ?? zip.Entries.FirstOrDefault(e => e.FullName.EndsWith(".opf", StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("No OPF package metadata found in this EPUB file.");

            var opfDir = Path.GetDirectoryName(opfEntry.FullName)?.Replace('\\', '/') ?? "";
            if (!string.IsNullOrEmpty(opfDir) && !opfDir.EndsWith('/')) opfDir += "/";

            XDocument opfDoc;
            using (var os = opfEntry.Open())
            {
                opfDoc = XDocument.Load(os);
            }

            XNamespace opfNs = "http://www.idpf.org/2007/opf";
            XNamespace dcNs = "http://purl.org/dc/elements/1.1/";

            var title = opfDoc.Descendants(dcNs + "title").FirstOrDefault()?.Value?.Trim()
                ?? Path.GetFileNameWithoutExtension(fileName);
            var author = opfDoc.Descendants(dcNs + "creator").FirstOrDefault()?.Value?.Trim();

            // Build NCX titles map if present
            var navTitles = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var ncxEntry = zip.Entries.FirstOrDefault(e => e.FullName.EndsWith(".ncx", StringComparison.OrdinalIgnoreCase));
            if (ncxEntry != null)
            {
                try
                {
                    using var ns = ncxEntry.Open();
                    var ncxDoc = XDocument.Load(ns);
                    XNamespace ncxNs = "http://www.daisy.org/z3986/2005/ncx/";
                    foreach (var np in ncxDoc.Descendants(ncxNs + "navPoint"))
                    {
                        var label = np.Element(ncxNs + "navLabel")?.Element(ncxNs + "text")?.Value?.Trim();
                        var src = np.Element(ncxNs + "content")?.Attribute("src")?.Value?.Trim();
                        if (!string.IsNullOrWhiteSpace(label) && !string.IsNullOrWhiteSpace(src))
                        {
                            var cleanSrc = src.Split('#')[0];
                            navTitles.TryAdd(cleanSrc, label);
                            // Also map relative path from opfDir
                            navTitles.TryAdd(opfDir + cleanSrc, label);
                        }
                    }
                }
                catch (Exception ncxEx)
                {
                    _logger.LogDebug(ncxEx, "Failed to parse toc.ncx, using default titles");
                }
            }

            // Read spine order from OPF manifest
            var manifestMap = opfDoc.Descendants(opfNs + "item")
                .Where(el => el.Attribute("id") != null && el.Attribute("href") != null)
                .ToDictionary(
                    el => el.Attribute("id")!.Value,
                    el => el.Attribute("href")!.Value,
                    StringComparer.OrdinalIgnoreCase);

            var spineItems = opfDoc.Descendants(opfNs + "itemref")
                .Select(el => el.Attribute("idref")?.Value)
                .Where(idref => !string.IsNullOrEmpty(idref) && manifestMap.ContainsKey(idref))
                .Select(idref => manifestMap[idref!])
                .ToList();

            var sections = new List<DocumentSection>();
            var fullTextBuilder = new StringBuilder();

            // If spine has items, use spine order; otherwise fallback to all html entries
            var targetHrefs = spineItems.Count > 0
                ? spineItems
                : zip.Entries.Where(e => e.FullName.EndsWith(".html", StringComparison.OrdinalIgnoreCase) ||
                                         e.FullName.EndsWith(".xhtml", StringComparison.OrdinalIgnoreCase) ||
                                         e.FullName.EndsWith(".htm", StringComparison.OrdinalIgnoreCase))
                             .Select(e => e.FullName)
                             .ToList();

            foreach (var href in targetHrefs)
            {
                var cleanHref = href.Split('#')[0];
                var entryPath = string.IsNullOrEmpty(opfDir) || cleanHref.StartsWith(opfDir, StringComparison.OrdinalIgnoreCase)
                    ? cleanHref
                    : opfDir + cleanHref;

                var entry = zip.GetEntry(entryPath)
                    ?? zip.Entries.FirstOrDefault(e => e.FullName.EndsWith(cleanHref, StringComparison.OrdinalIgnoreCase));

                if (entry == null) continue;

                string htmlContent;
                using (var es = entry.Open())
                using (var reader = new StreamReader(es, Encoding.UTF8))
                {
                    htmlContent = reader.ReadToEnd();
                }

                var plainText = StripHtmlToText(htmlContent);
                if (string.IsNullOrWhiteSpace(plainText))
                {
                    continue;
                }

                var chapterTitle = navTitles.TryGetValue(cleanHref, out var t1) ? t1
                    : navTitles.TryGetValue(entry.FullName, out var t2) ? t2
                    : ExtractHtmlTitle(htmlContent) ?? $"Chapter {sections.Count + 1}";

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

            if (sections.Count == 0)
            {
                throw new InvalidOperationException("No readable chapter text found in this EPUB file.");
            }

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

    private ExtractedDocument ExtractDocx(string fileName, Stream stream)
    {
        try
        {
            using var zip = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true);
            var docEntry = zip.GetEntry("word/document.xml")
                ?? throw new InvalidOperationException("Invalid DOCX format: word/document.xml not found.");

            using var entryStream = docEntry.Open();
            var docXml = XDocument.Load(entryStream);
            XNamespace w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

            var paragraphs = docXml.Descendants(w + "p")
                .Select(p => string.Concat(p.Descendants(w + "t").Select(t => t.Value)).Trim())
                .Where(text => !string.IsNullOrWhiteSpace(text))
                .ToList();

            var sections = new List<DocumentSection>();
            var fullTextBuilder = new StringBuilder();

            const int maxSectionChars = 3000;
            var currentSectionBuilder = new StringBuilder();
            var sectionIndex = 1;

            foreach (var para in paragraphs)
            {
                if (currentSectionBuilder.Length + para.Length > maxSectionChars && currentSectionBuilder.Length > 0)
                {
                    var secText = currentSectionBuilder.ToString().Trim();
                    sections.Add(new DocumentSection(
                        Index: sectionIndex,
                        Title: $"Section {sectionIndex}",
                        Content: secText,
                        CharacterCount: secText.Length
                    ));
                    sectionIndex++;
                    currentSectionBuilder.Clear();
                }

                if (currentSectionBuilder.Length > 0)
                {
                    currentSectionBuilder.AppendLine().AppendLine();
                }
                currentSectionBuilder.Append(para);

                if (fullTextBuilder.Length > 0)
                {
                    fullTextBuilder.AppendLine().AppendLine();
                }
                fullTextBuilder.Append(para);
            }

            if (currentSectionBuilder.Length > 0)
            {
                var remainingText = currentSectionBuilder.ToString().Trim();
                sections.Add(new DocumentSection(
                    Index: sectionIndex,
                    Title: $"Section {sectionIndex}",
                    Content: remainingText,
                    CharacterCount: remainingText.Length
                ));
            }

            var fullText = fullTextBuilder.ToString();
            var title = Path.GetFileNameWithoutExtension(fileName);

            return new ExtractedDocument(
                Id: Guid.NewGuid().ToString("N"),
                FileName: fileName,
                FileType: "docx",
                Title: title,
                Author: null,
                FullText: fullText,
                TotalCharacters: fullText.Length,
                Sections: sections,
                CreatedAtUtc: DateTime.UtcNow
            );
        }
        catch (Exception ex) when (ex is not InvalidOperationException)
        {
            _logger.LogWarning(ex, "Failed to parse DOCX {FileName}", fileName);
            throw new InvalidOperationException("The uploaded Word (.docx) file appears to be corrupted or unreadable.", ex);
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
