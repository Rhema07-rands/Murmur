using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Murmur.API.Models;
using MySqlConnector;

namespace Murmur.API.Services;

public sealed class TiDbAuthService : IAuthService
{
    private readonly string _connectionString;
    private readonly string _jwtSecret;
    private readonly ILogger<TiDbAuthService> _logger;
    private volatile bool _initialized;
    private readonly SemaphoreSlim _initLock = new(1, 1);
    private string _targetDatabase = "murmur_library";

    public TiDbAuthService(
        IConfiguration configuration,
        ILogger<TiDbAuthService> logger)
    {
        _connectionString = configuration.GetConnectionString("TiDB")
            ?? throw new InvalidOperationException("TiDB connection string is not configured.");
        _jwtSecret = configuration["Auth:JwtSecret"] ?? "Murmur-Secure-Secret-Key-For-Token-Signing-2026";
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

            const string createUsersSql = """
                CREATE TABLE IF NOT EXISTS murmur_users (
                    id VARCHAR(64) PRIMARY KEY,
                    username VARCHAR(100) NOT NULL UNIQUE,
                    password_hash VARCHAR(255) NOT NULL,
                    password_salt VARCHAR(255) NOT NULL,
                    created_at_utc DATETIME NOT NULL,
                    INDEX idx_username (username)
                );
                """;

            await using var usersCmd = new MySqlCommand(createUsersSql, conn);
            await usersCmd.ExecuteNonQueryAsync(cancellationToken);

            // Also ensure user_id column exists on saved documents and novels
            try
            {
                await using var alterDocsCmd = new MySqlCommand(
                    "ALTER TABLE murmur_saved_documents ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NULL, ADD INDEX IF NOT EXISTS idx_user (user_id);",
                    conn);
                await alterDocsCmd.ExecuteNonQueryAsync(cancellationToken);
            }
            catch { /* Ignore if already exists */ }

            try
            {
                await using var alterNovelsCmd = new MySqlCommand(
                    "ALTER TABLE murmur_novels ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NULL, ADD INDEX IF NOT EXISTS idx_user (user_id);",
                    conn);
                await alterNovelsCmd.ExecuteNonQueryAsync(cancellationToken);
            }
            catch { /* Ignore if already exists */ }

            _initialized = true;
        }
        finally
        {
            _initLock.Release();
        }
    }

    public async Task<AuthResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default)
    {
        var username = request.Username?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(username) || username.Length < 3)
        {
            throw new InvalidOperationException("Username must be at least 3 characters.");
        }
        if (username.Length > 50)
        {
            throw new InvalidOperationException("Username cannot exceed 50 characters.");
        }
        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 6)
        {
            throw new InvalidOperationException("Password must be at least 6 characters.");
        }

        await using var conn = await OpenConnectionAsync(cancellationToken);

        // Check if username already exists
        const string checkSql = "SELECT COUNT(1) FROM murmur_users WHERE username = @username;";
        await using var checkCmd = new MySqlCommand(checkSql, conn);
        checkCmd.Parameters.AddWithValue("@username", username);
        var exists = Convert.ToInt64(await checkCmd.ExecuteScalarAsync(cancellationToken)) > 0;
        if (exists)
        {
            throw new InvalidOperationException("That username is already taken. Please choose another.");
        }

        // Hash password
        var saltBytes = RandomNumberGenerator.GetBytes(16);
        var salt = Convert.ToBase64String(saltBytes);
        var hash = HashPassword(request.Password, salt);

        var userId = Guid.NewGuid().ToString("N");
        var now = DateTime.UtcNow;

        const string insertSql = """
            INSERT INTO murmur_users (id, username, password_hash, password_salt, created_at_utc)
            VALUES (@id, @username, @hash, @salt, @created);
            """;

        await using var insertCmd = new MySqlCommand(insertSql, conn);
        insertCmd.Parameters.AddWithValue("@id", userId);
        insertCmd.Parameters.AddWithValue("@username", username);
        insertCmd.Parameters.AddWithValue("@hash", hash);
        insertCmd.Parameters.AddWithValue("@salt", salt);
        insertCmd.Parameters.AddWithValue("@created", now);
        await insertCmd.ExecuteNonQueryAsync(cancellationToken);

        var token = CreateToken(userId, username);
        return new AuthResponse(token, userId, username);
    }

    public async Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default)
    {
        var username = request.Username?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(request.Password))
        {
            throw new InvalidOperationException("Username and password are required.");
        }

        await using var conn = await OpenConnectionAsync(cancellationToken);

        const string sql = "SELECT id, username, password_hash, password_salt FROM murmur_users WHERE username = @username LIMIT 1;";
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@username", username);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            throw new InvalidOperationException("Invalid username or password.");
        }

        var userId = reader.GetString("id");
        var dbUsername = reader.GetString("username");
        var dbHash = reader.GetString("password_hash");
        var dbSalt = reader.GetString("password_salt");

        var computedHash = HashPassword(request.Password, dbSalt);
        if (!CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(computedHash),
            Encoding.UTF8.GetBytes(dbHash)))
        {
            throw new InvalidOperationException("Invalid username or password.");
        }

        var token = CreateToken(userId, dbUsername);
        return new AuthResponse(token, userId, dbUsername);
    }

    public async Task<UserProfile?> GetUserByIdAsync(string userId, CancellationToken cancellationToken = default)
    {
        await using var conn = await OpenConnectionAsync(cancellationToken);

        const string sql = "SELECT id, username, created_at_utc FROM murmur_users WHERE id = @id LIMIT 1;";
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", userId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;

        return new UserProfile(
            reader.GetString("id"),
            reader.GetString("username"),
            DateTime.SpecifyKind(reader.GetDateTime("created_at_utc"), DateTimeKind.Utc)
        );
    }

    private static string HashPassword(string password, string salt)
    {
        var combined = $"{salt}:{password}";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(combined));
        return Convert.ToBase64String(bytes);
    }

    private string CreateToken(string userId, string username)
    {
        var payload = new
        {
            sub = userId,
            name = username,
            exp = DateTimeOffset.UtcNow.AddDays(30).ToUnixTimeSeconds()
        };

        var json = JsonSerializer.Serialize(payload);
        var base64Payload = Convert.ToBase64String(Encoding.UTF8.GetBytes(json))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

        var header = Convert.ToBase64String(Encoding.UTF8.GetBytes("{\"alg\":\"HS256\",\"typ\":\"JWT\"}"))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

        var unsigned = $"{header}.{base64Payload}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_jwtSecret));
        var sigBytes = hmac.ComputeHash(Encoding.UTF8.GetBytes(unsigned));
        var sig = Convert.ToBase64String(sigBytes)
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

        return $"{unsigned}.{sig}";
    }

    public string? ValidateTokenAndGetUserId(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;

        // If prefixed with Bearer
        if (token.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            token = token[7..].Trim();
        }

        var parts = token.Split('.');
        if (parts.Length != 3) return null;

        try
        {
            var unsigned = $"{parts[0]}.{parts[1]}";
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_jwtSecret));
            var computedSig = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(unsigned)))
                .TrimEnd('=').Replace('+', '-').Replace('/', '_');

            if (!CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(parts[2]),
                Encoding.UTF8.GetBytes(computedSig)))
            {
                return null;
            }

            var rem = parts[1].Length % 4;
            var pad = rem == 2 ? "==" : (rem == 3 ? "=" : "");
            var jsonBytes = Convert.FromBase64String(parts[1].Replace('-', '+').Replace('_', '/') + pad);
            using var doc = JsonDocument.Parse(jsonBytes);

            if (doc.RootElement.TryGetProperty("exp", out var expEl))
            {
                var exp = expEl.GetInt64();
                if (DateTimeOffset.UtcNow.ToUnixTimeSeconds() > exp)
                {
                    return null; // Expired
                }
            }

            if (doc.RootElement.TryGetProperty("sub", out var subEl))
            {
                return subEl.GetString();
            }
        }
        catch
        {
            return null;
        }

        return null;
    }
}
