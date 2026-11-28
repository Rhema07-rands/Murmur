using Murmur.API.Models;
using MySqlConnector;

namespace Murmur.API.Services;

public sealed class TiDbDocumentLibraryService : IDocumentLibraryService
{
    private readonly string _connectionString;
    private readonly ILogger<TiDbDocumentLibraryService> _logger;
    private volatile bool _initialized;
    private readonly SemaphoreSlim _initLock = new(1, 1);
    private string _targetDatabase = "murmur_library";

    public TiDbDocumentLibraryService(
        IConfiguration configuration,
        ILogger<TiDbDocumentLibraryService> logger)
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

            var builder = new MySqlConnectionStringBuilder(_connectionString);
            var configuredDb = string.IsNullOrWhiteSpace(builder.Database) ? "sys" : builder.Database;

            await using var conn = new MySqlConnection(_connectionString);
            await conn.OpenAsync(cancellationToken);

            // Try creating dedicated murmur_library database first so we don't pollute sys
            try
            {
                await using var dbCmd = new MySqlCommand("CREATE DATABASE IF NOT EXISTS murmur_library;", conn);
                await dbCmd.ExecuteNonQueryAsync(cancellationToken);
                _targetDatabase = "murmur_library";
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not create murmur_library database, falling back to {Db}", configuredDb);
                _targetDatabase = configuredDb;
            }

            await using var useCmd = new MySqlCommand($"USE `{_targetDatabase}`;", conn);
            await useCmd.ExecuteNonQueryAsync(cancellationToken);

            const string createTableSql = """
                CREATE TABLE IF NOT EXISTS murmur_saved_documents (
                    id VARCHAR(64) PRIMARY KEY,
                    user_id VARCHAR(64) NULL,
                    folder_name VARCHAR(120) NOT NULL DEFAULT 'General',
                    title VARCHAR(255) NOT NULL,
                    file_type VARCHAR(32) NOT NULL DEFAULT 'text',
                    content LONGTEXT NOT NULL,
                    character_count INT NOT NULL,
                    created_at_utc DATETIME NOT NULL,
                    updated_at_utc DATETIME NOT NULL,
                    INDEX idx_folder (folder_name),
                    INDEX idx_user (user_id),
                    INDEX idx_created (created_at_utc)
                );
                """;

            await using var tableCmd = new MySqlCommand(createTableSql, conn);
            await tableCmd.ExecuteNonQueryAsync(cancellationToken);

            // Migrate existing murmur_saved_documents table if it was created before user_id existed
            const string checkColSql = """
                SELECT COUNT(1)
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'murmur_saved_documents' AND COLUMN_NAME = 'user_id';
                """;
            await using var checkColCmd = new MySqlCommand(checkColSql, conn);
            checkColCmd.Parameters.AddWithValue("@db", _targetDatabase);
            var hasUserCol = Convert.ToInt64(await checkColCmd.ExecuteScalarAsync(cancellationToken)) > 0;
            if (!hasUserCol)
            {
                await using var addColCmd = new MySqlCommand(
                    "ALTER TABLE murmur_saved_documents ADD COLUMN user_id VARCHAR(64) NULL;", conn);
                await addColCmd.ExecuteNonQueryAsync(cancellationToken);

                try
                {
                    await using var addIdxCmd = new MySqlCommand(
                        "CREATE INDEX idx_user ON murmur_saved_documents (user_id);", conn);
                    await addIdxCmd.ExecuteNonQueryAsync(cancellationToken);
                }
                catch { /* Index may already exist */ }
            }

            _initialized = true;
        }
        finally
        {
            _initLock.Release();
        }
    }

    public async Task<IReadOnlyList<SavedDocumentSummary>> ListDocumentsAsync(
        string? folderName = null,
        string? userId = null,
        CancellationToken cancellationToken = default)
    {
        await using var conn = await OpenConnectionAsync(cancellationToken);

        var hasFolder = !string.IsNullOrWhiteSpace(folderName) && !folderName.Equals("All", StringComparison.OrdinalIgnoreCase);
        var hasUser = !string.IsNullOrWhiteSpace(userId);

        var conditions = new List<string>();
        if (hasFolder) conditions.Add("folder_name = @folder");
        if (hasUser) conditions.Add("(user_id = @userId OR user_id IS NULL)");

        var whereClause = conditions.Count > 0 ? "WHERE " + string.Join(" AND ", conditions) : "";

        var sql = $"""
            SELECT id, folder_name, title, file_type, character_count, created_at_utc, updated_at_utc
            FROM murmur_saved_documents
            {whereClause}
            ORDER BY updated_at_utc DESC;
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        if (hasFolder) cmd.Parameters.AddWithValue("@folder", folderName!.Trim());
        if (hasUser) cmd.Parameters.AddWithValue("@userId", userId);

        var results = new List<SavedDocumentSummary>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(new SavedDocumentSummary(
                Id: reader.GetString("id"),
                FolderName: reader.GetString("folder_name"),
                Title: reader.GetString("title"),
                FileType: reader.GetString("file_type"),
                CharacterCount: reader.GetInt32("character_count"),
                CreatedAtUtc: DateTime.SpecifyKind(reader.GetDateTime("created_at_utc"), DateTimeKind.Utc),
                UpdatedAtUtc: DateTime.SpecifyKind(reader.GetDateTime("updated_at_utc"), DateTimeKind.Utc)
            ));
        }

        return results;
    }

    public async Task<IReadOnlyList<string>> ListFoldersAsync(string? userId = null, CancellationToken cancellationToken = default)
    {
        await using var conn = await OpenConnectionAsync(cancellationToken);

        var hasUser = !string.IsNullOrWhiteSpace(userId);
        var sql = hasUser
            ? "SELECT DISTINCT folder_name FROM murmur_saved_documents WHERE (user_id = @userId OR user_id IS NULL) ORDER BY folder_name ASC;"
            : "SELECT DISTINCT folder_name FROM murmur_saved_documents ORDER BY folder_name ASC;";

        await using var cmd = new MySqlCommand(sql, conn);
        if (hasUser) cmd.Parameters.AddWithValue("@userId", userId);

        var folders = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            folders.Add(reader.GetString("folder_name"));
        }

        return folders;
    }

    public async Task<SavedDocumentDetail?> GetDocumentAsync(
        string id,
        string? userId = null,
        CancellationToken cancellationToken = default)
    {
        await using var conn = await OpenConnectionAsync(cancellationToken);

        var hasUser = !string.IsNullOrWhiteSpace(userId);
        var sql = hasUser
            ? "SELECT id, folder_name, title, file_type, content, character_count, created_at_utc, updated_at_utc FROM murmur_saved_documents WHERE id = @id AND (user_id = @userId OR user_id IS NULL) LIMIT 1;"
            : "SELECT id, folder_name, title, file_type, content, character_count, created_at_utc, updated_at_utc FROM murmur_saved_documents WHERE id = @id LIMIT 1;";

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", id);
        if (hasUser) cmd.Parameters.AddWithValue("@userId", userId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new SavedDocumentDetail(
            Id: reader.GetString("id"),
            FolderName: reader.GetString("folder_name"),
            Title: reader.GetString("title"),
            FileType: reader.GetString("file_type"),
            Content: reader.GetString("content"),
            CharacterCount: reader.GetInt32("character_count"),
            CreatedAtUtc: DateTime.SpecifyKind(reader.GetDateTime("created_at_utc"), DateTimeKind.Utc),
            UpdatedAtUtc: DateTime.SpecifyKind(reader.GetDateTime("updated_at_utc"), DateTimeKind.Utc)
        );
    }

    public async Task<SavedDocumentSummary> SaveDocumentAsync(
        SaveDocumentRequest request,
        string? userId = null,
        CancellationToken cancellationToken = default)
    {
        await using var conn = await OpenConnectionAsync(cancellationToken);

        var id = Guid.NewGuid().ToString("N");
        var folder = string.IsNullOrWhiteSpace(request.FolderName) ? "General" : request.FolderName.Trim();
        var title = string.IsNullOrWhiteSpace(request.Title) ? "Untitled Document" : request.Title.Trim();
        var fileType = string.IsNullOrWhiteSpace(request.FileType) ? "text" : request.FileType.Trim();
        var now = DateTime.UtcNow;

        if (folder.Length > 120) folder = folder[..120];
        if (title.Length > 255) title = title[..255];

        const string sql = """
            INSERT INTO murmur_saved_documents
                (id, user_id, folder_name, title, file_type, content, character_count, created_at_utc, updated_at_utc)
            VALUES
                (@id, @userId, @folder, @title, @fileType, @content, @charCount, @created, @updated);
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.AddWithValue("@userId", (object?)userId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@folder", folder);
        cmd.Parameters.AddWithValue("@title", title);
        cmd.Parameters.AddWithValue("@fileType", fileType);
        cmd.Parameters.AddWithValue("@content", request.Content);
        cmd.Parameters.AddWithValue("@charCount", request.Content.Length);
        cmd.Parameters.AddWithValue("@created", now);
        cmd.Parameters.AddWithValue("@updated", now);

        await cmd.ExecuteNonQueryAsync(cancellationToken);

        return new SavedDocumentSummary(
            Id: id,
            FolderName: folder,
            Title: title,
            FileType: fileType,
            CharacterCount: request.Content.Length,
            CreatedAtUtc: now,
            UpdatedAtUtc: now
        );
    }

    public async Task<bool> DeleteDocumentAsync(
        string id,
        string? userId = null,
        CancellationToken cancellationToken = default)
    {
        await using var conn = await OpenConnectionAsync(cancellationToken);

        var hasUser = !string.IsNullOrWhiteSpace(userId);
        var sql = hasUser
            ? "DELETE FROM murmur_saved_documents WHERE id = @id AND (user_id = @userId OR user_id IS NULL);"
            : "DELETE FROM murmur_saved_documents WHERE id = @id;";

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", id);
        if (hasUser) cmd.Parameters.AddWithValue("@userId", userId);

        var affected = await cmd.ExecuteNonQueryAsync(cancellationToken);
        return affected > 0;
    }
}
