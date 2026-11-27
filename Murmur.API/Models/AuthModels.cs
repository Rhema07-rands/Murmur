namespace Murmur.API.Models;

public sealed record RegisterRequest(
    string Username,
    string Password
);

public sealed record LoginRequest(
    string Username,
    string Password
);

public sealed record AuthResponse(
    string Token,
    string UserId,
    string Username
);

public sealed record UserProfile(
    string Id,
    string Username,
    DateTime CreatedAtUtc
);
