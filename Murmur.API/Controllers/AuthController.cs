using Microsoft.AspNetCore.Mvc;
using Murmur.API.Models;
using Murmur.API.Services;

namespace Murmur.API.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController : ControllerBase
{
    private readonly IAuthService _authService;

    public AuthController(IAuthService authService)
    {
        _authService = authService;
    }

    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(
        [FromBody] RegisterRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            var res = await _authService.RegisterAsync(request, cancellationToken);
            return Ok(res);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(
        [FromBody] LoginRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            var res = await _authService.LoginAsync(request, cancellationToken);
            return Ok(res);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpGet("me")]
    public async Task<ActionResult<UserProfile>> Me(CancellationToken cancellationToken)
    {
        var authHeader = Request.Headers.Authorization.ToString();
        var userId = _authService.ValidateTokenAndGetUserId(authHeader);

        if (string.IsNullOrWhiteSpace(userId))
        {
            return Unauthorized(new { error = "Not authenticated." });
        }

        var profile = await _authService.GetUserByIdAsync(userId, cancellationToken);
        if (profile is null)
        {
            return NotFound(new { error = "User not found." });
        }

        return Ok(profile);
    }
}
