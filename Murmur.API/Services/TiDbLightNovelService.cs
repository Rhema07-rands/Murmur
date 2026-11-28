using Murmur.API.Models;
using MySqlConnector;

namespace Murmur.API.Services;

public sealed class TiDbLightNovelService : ILightNovelService
{
    private readonly string _connectionString;
    private readonly ILogger<TiDbLightNovelService> _logger;
    private volatile bool _initialized;
    private readonly SemaphoreSlim _initLock = new(1, 1);
    private string _targetDatabase = "murmur_library";

    private static readonly string[] CoverColors =
    [
        "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316",
        "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6"
    ];

    public TiDbLightNovelService(IConfiguration configuration, ILogger<TiDbLightNovelService> logger)
    {
        _connectionString = configuration.GetConnectionString("TiDB")
            ?? throw new InvalidOperationException("TiDB connection string is not configured.");
        _logger = logger;
    }

    private async Task<MySqlConnection> OpenConnectionAsync(CancellationToken cancellationToken)
    {
        if (!_initialized)
        {
            await EnsureInitializedAsync(cancellationToken);
        }

        var builder = new MySqlConnectionStringBuilder(_connectionString)
        {
            Database = _targetDatabase
        };

        var conn = new MySqlConnection(builder.ConnectionString);
        await conn.OpenAsync(cancellationToken);
        return conn;
    }

    private async Task EnsureInitializedAsync(CancellationToken cancellationToken)
    {
        if (_initialized) return;

        await _initLock.WaitAsync(cancellationToken);
        try
        {
            if (_initialized) return;

            await using var conn = new MySqlConnection(_connectionString);
            await conn.OpenAsync(cancellationToken);

            try
            {
                await using var dbCmd = new MySqlCommand("CREATE DATABASE IF NOT EXISTS murmur_library;", conn);
                await dbCmd.ExecuteNonQueryAsync(cancellationToken);
                _targetDatabase = "murmur_library";
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not create murmur_library database, using configured DB");
                var builder = new MySqlConnectionStringBuilder(_connectionString);
                _targetDatabase = string.IsNullOrWhiteSpace(builder.Database) ? "sys" : builder.Database;
            }

            await using var useCmd = new MySqlCommand($"USE `{_targetDatabase}`;", conn);
            await useCmd.ExecuteNonQueryAsync(cancellationToken);

            const string createNovelsSql = """
                CREATE TABLE IF NOT EXISTS murmur_novels (
                    id VARCHAR(64) PRIMARY KEY,
                    user_id VARCHAR(64) NULL,
                    title VARCHAR(500) NOT NULL,
                    author VARCHAR(255),
                    total_chapters INT NOT NULL DEFAULT 0,
                    total_characters BIGINT NOT NULL DEFAULT 0,
                    last_read_chapter INT NOT NULL DEFAULT 0,
                    cover_color VARCHAR(20),
                    uploaded_at_utc DATETIME NOT NULL,
                    INDEX idx_user (user_id),
                    INDEX idx_uploaded (uploaded_at_utc)
                );
                """;

            await using var novelsCmd = new MySqlCommand(createNovelsSql, conn);
            await novelsCmd.ExecuteNonQueryAsync(cancellationToken);

            // Migrate existing murmur_novels table if it was created before user_id existed
            const string checkColSql = """
                SELECT COUNT(1)
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'murmur_novels' AND COLUMN_NAME = 'user_id';
                """;
            await using var checkColCmd = new MySqlCommand(checkColSql, conn);
            checkColCmd.Parameters.AddWithValue("@db", _targetDatabase);
            var hasUserCol = Convert.ToInt64(await checkColCmd.ExecuteScalarAsync(cancellationToken)) > 0;
            if (!hasUserCol)
            {
                await using var addColCmd = new MySqlCommand(
                    "ALTER TABLE murmur_novels ADD COLUMN user_id VARCHAR(64) NULL;", conn);
                await addColCmd.ExecuteNonQueryAsync(cancellationToken);

                try
                {
                    await using var addIdxCmd = new MySqlCommand(
                        "CREATE INDEX idx_user ON murmur_novels (user_id);", conn);
                    await addIdxCmd.ExecuteNonQueryAsync(cancellationToken);
                }
                catch { /* Index may already exist */ }
            }

            const string createChaptersSql = """
                CREATE TABLE IF NOT EXISTS murmur_novel_chapters (
                    novel_id VARCHAR(64) NOT NULL,
                    chapter_index INT NOT NULL,
                    title VARCHAR(500) NOT NULL,
                    content LONGTEXT NOT NULL,
                    character_count INT NOT NULL,
                    PRIMARY KEY (novel_id, chapter_index),
                    INDEX idx_novel (novel_id)
                );
                """;

            await using var chaptersCmd = new MySqlCommand(createChaptersSql, conn);
            await chaptersCmd.ExecuteNonQueryAsync(cancellationToken);

            _initialized = true;
        }
        finally
        {
            _initLock.Release();
        }
    }

    public async Task<NovelUploadResponse> UploadNovelAsync(
        string title,
        string? author,
        IReadOnlyList<DocumentSection> chapters,
        string? userId = null,
        Action<int, int>? onProgress = null,
        CancellationToken cancellationToken = default)
    {
        await using var conn = await OpenConnectionAsync(cancellationToken);

        var novelId = Guid.NewGuid().ToString("N");
        var totalChars = chapters.Sum(c => (long)c.CharacterCount);
        var color = CoverColors[Math.Abs(title.GetHashCode()) % CoverColors.Length];
        var now = DateTime.UtcNow;

        const string insertNovelSql = """
            INSERT INTO murmur_novels
                (id, user_id, title, author, total_chapters, total_characters, last_read_chapter, cover_color, uploaded_at_utc)
            VALUES
                (@id, @userId, @title, @author, @totalChapters, @totalChars, 0, @color, @uploaded);
            """;

        await using var novelCmd = new MySqlCommand(insertNovelSql, conn);
        novelCmd.Parameters.AddWithValue("@id", novelId);
        novelCmd.Parameters.AddWithValue("@userId", (object?)userId ?? DBNull.Value);
        novelCmd.Parameters.AddWithValue("@title", title.Length > 500 ? title[..500] : title);
        novelCmd.Parameters.AddWithValue("@author", (object?)author ?? DBNull.Value);
        novelCmd.Parameters.AddWithValue("@totalChapters", chapters.Count);
        novelCmd.Parameters.AddWithValue("@totalChars", totalChars);
        novelCmd.Parameters.AddWithValue("@color", color);
        novelCmd.Parameters.AddWithValue("@uploaded", now);
        await novelCmd.ExecuteNonQueryAsync(cancellationToken);

        // High-speed batch insertion (100 chapters per batch)
        const int batchSize = 100;
        for (var i = 0; i < chapters.Count; i += batchSize)
        {
            var batch = chapters.Skip(i).Take(batchSize).ToList();
            var values = new List<string>();
            var cmd = new MySqlCommand { Connection = conn };

            for (var j = 0; j < batch.Count; j++)
            {
                var ch = batch[j];
                values.Add($"(@nid, @ci{j}, @ct{j}, @cc{j}, @ccnt{j})");
                cmd.Parameters.AddWithValue($"@ci{j}", ch.Index);
                cmd.Parameters.AddWithValue($"@ct{j}", ch.Title.Length > 500 ? ch.Title[..500] : ch.Title);
                cmd.Parameters.AddWithValue($"@cc{j}", ch.Content);
                cmd.Parameters.AddWithValue($"@ccnt{j}", ch.CharacterCount);
            }

            cmd.Parameters.AddWithValue("@nid", novelId);
            cmd.CommandText = $"INSERT INTO murmur_novel_chapters (novel_id, chapter_index, title, content, character_count) VALUES {string.Join(", ", values)};";
            await cmd.ExecuteNonQueryAsync(cancellationToken);
            await cmd.DisposeAsync();

            onProgress?.Invoke(Math.Min(i + batch.Count, chapters.Count), chapters.Count);
        }

        return new NovelUploadResponse(
            Id: novelId,
            Title: title,
            Author: author,
            TotalChapters: chapters.Count,
            TotalCharacters: totalChars,
            Message: $"Successfully imported {chapters.Count} chapters ({totalChars:N0} characters)."
        );
    }

    public async Task<IReadOnlyList<NovelSummary>> ListNovelsAsync(string? userId = null, CancellationToken cancellationToken = default)
    {
        await using var conn = await OpenConnectionAsync(cancellationToken);

        var hasUser = !string.IsNullOrWhiteSpace(userId);
        var sql = hasUser
            ? """
              SELECT id, title, author, total_chapters, total_characters, last_read_chapter, cover_color, uploaded_at_utc
              FROM murmur_novels
              WHERE (user_id = @userId OR user_id IS NULL)
              ORDER BY uploaded_at_utc DESC;
              """
            : """
              SELECT id, title, author, total_chapters, total_characters, last_read_chapter, cover_color, uploaded_at_utc
              FROM murmur_novels
              ORDER BY uploaded_at_utc DESC;
              """;

        await using var cmd = new MySqlCommand(sql, conn);
        if (hasUser) cmd.Parameters.AddWithValue("@userId", userId);

        var results = new List<NovelSummary>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(new NovelSummary(
                Id: reader.GetString("id"),
                Title: reader.GetString("title"),
                Author: reader.IsDBNull(reader.GetOrdinal("author")) ? null : reader.GetString("author"),
                TotalChapters: reader.GetInt32("total_chapters"),
                TotalCharacters: reader.GetInt64("total_characters"),
                LastReadChapter: reader.GetInt32("last_read_chapter"),
                CoverColor: reader.IsDBNull(reader.GetOrdinal("cover_color")) ? null : reader.GetString("cover_color"),
                UploadedAtUtc: DateTime.SpecifyKind(reader.GetDateTime("uploaded_at_utc"), DateTimeKind.Utc)
            ));
        }
        return results;
    }

    public async Task<NovelSummary?> GetNovelAsync(string novelId, string? userId = null, CancellationToken cancellationToken = default)
    {
        await using var conn = await OpenConnectionAsync(cancellationToken);

        var hasUser = !string.IsNullOrWhiteSpace(userId);
        var sql = hasUser
            ? "SELECT id, title, author, total_chapters, total_characters, last_read_chapter, cover_color, uploaded_at_utc FROM murmur_novels WHERE id = @id AND (user_id = @userId OR user_id IS NULL) LIMIT 1;"
            : "SELECT id, title, author, total_chapters, total_characters, last_read_chapter, cover_color, uploaded_at_utc FROM murmur_novels WHERE id = @id LIMIT 1;";

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", novelId);
        if (hasUser) cmd.Parameters.AddWithValue("@userId", userId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);

        if (!await reader.ReadAsync(cancellationToken)) return null;

        return new NovelSummary(
            Id: reader.GetString("id"),
            Title: reader.GetString("title"),
            Author: reader.IsDBNull(reader.GetOrdinal("author")) ? null : reader.GetString("author"),
            TotalChapters: reader.GetInt32("total_chapters"),
            TotalCharacters: reader.GetInt64("total_characters"),
            LastReadChapter: reader.GetInt32("last_read_chapter"),
            CoverColor: reader.IsDBNull(reader.GetOrdinal("cover_color")) ? null : reader.GetString("cover_color"),
            UploadedAtUtc: DateTime.SpecifyKind(reader.GetDateTime("uploaded_at_utc"), DateTimeKind.Utc)
        );
    }

    public async Task<IReadOnlyList<NovelChapterSummary>> ListChaptersAsync(
        string novelId,
        CancellationToken cancellationToken = default)
    {
        await using var conn = await OpenConnectionAsync(cancellationToken);

        const string sql = """
            SELECT chapter_index, title, character_count
            FROM murmur_novel_chapters
            WHERE novel_id = @nid
            ORDER BY chapter_index ASC;
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@nid", novelId);
        var results = new List<NovelChapterSummary>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(new NovelChapterSummary(
                ChapterIndex: reader.GetInt32("chapter_index"),
                Title: reader.GetString("title"),
                CharacterCount: reader.GetInt32("character_count")
            ));
        }
        return results;
    }

    public async Task<NovelChapterDetail?> GetChapterAsync(
        string novelId,
        int chapterIndex,
        CancellationToken cancellationToken = default)
    {
        await using var conn = await OpenConnectionAsync(cancellationToken);

        const string sql = """
            SELECT c.novel_id, c.chapter_index, c.title, c.content, c.character_count, n.total_chapters
            FROM murmur_novel_chapters c
            JOIN murmur_novels n ON n.id = c.novel_id
            WHERE c.novel_id = @nid AND c.chapter_index = @ci
            LIMIT 1;
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@nid", novelId);
        cmd.Parameters.AddWithValue("@ci", chapterIndex);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);

        if (!await reader.ReadAsync(cancellationToken)) return null;

        return new NovelChapterDetail(
            NovelId: reader.GetString("novel_id"),
            ChapterIndex: reader.GetInt32("chapter_index"),
            Title: reader.GetString("title"),
            Content: reader.GetString("content"),
            CharacterCount: reader.GetInt32("character_count"),
            TotalChapters: reader.GetInt32("total_chapters")
        );
    }

    public async Task<bool> UpdateReadingProgressAsync(
        string novelId,
        int chapterIndex,
        CancellationToken cancellationToken = default)
    {
        await using var conn = await OpenConnectionAsync(cancellationToken);

        const string sql = """
            UPDATE murmur_novels SET last_read_chapter = @ci WHERE id = @id;
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", novelId);
        cmd.Parameters.AddWithValue("@ci", chapterIndex);
        return await cmd.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    public async Task<bool> DeleteNovelAsync(string novelId, string? userId = null, CancellationToken cancellationToken = default)
    {
        await using var conn = await OpenConnectionAsync(cancellationToken);

        var hasUser = !string.IsNullOrWhiteSpace(userId);

        // Verify ownership if user is logged in
        if (hasUser)
        {
            const string verifySql = "SELECT COUNT(1) FROM murmur_novels WHERE id = @id AND (user_id = @userId OR user_id IS NULL);";
            await using var verifyCmd = new MySqlCommand(verifySql, conn);
            verifyCmd.Parameters.AddWithValue("@id", novelId);
            verifyCmd.Parameters.AddWithValue("@userId", userId);
            if (Convert.ToInt64(await verifyCmd.ExecuteScalarAsync(cancellationToken)) == 0)
            {
                return false;
            }
        }

        await using var chCmd = new MySqlCommand("DELETE FROM murmur_novel_chapters WHERE novel_id = @id;", conn);
        chCmd.Parameters.AddWithValue("@id", novelId);
        await chCmd.ExecuteNonQueryAsync(cancellationToken);

        var deleteNovelSql = hasUser
            ? "DELETE FROM murmur_novels WHERE id = @id AND (user_id = @userId OR user_id IS NULL);"
            : "DELETE FROM murmur_novels WHERE id = @id;";

        await using var nCmd = new MySqlCommand(deleteNovelSql, conn);
        nCmd.Parameters.AddWithValue("@id", novelId);
        if (hasUser) nCmd.Parameters.AddWithValue("@userId", userId);

        return await nCmd.ExecuteNonQueryAsync(cancellationToken) > 0;
    }
}
