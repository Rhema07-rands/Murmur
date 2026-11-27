using Murmur.API.Models;

namespace Murmur.API.Services;

public interface IAuthService
{
    Task<AuthResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default);
    Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default);
    Task<UserProfile?> GetUserByIdAsync(string userId, CancellationToken cancellationToken = default);
    string? ValidateTokenAndGetUserId(string? token);
}
