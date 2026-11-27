using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;

namespace Murmur.API.Services;

public static class EdgeTtsClient
{
    private const string TrustedClientToken = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
    private const long WindowsEpochOffsetSeconds = 11644473600L;

    public static string GenerateSecMsGecToken()
    {
        var unixSeconds = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var ticks = (unixSeconds + WindowsEpochOffsetSeconds) * 10_000_000L;
        var roundedTicks = ticks - (ticks % 3_000_000_000L);
        var input = $"{roundedTicks}{TrustedClientToken}";
        var hashBytes = SHA256.HashData(Encoding.ASCII.GetBytes(input));
        return Convert.ToHexString(hashBytes).ToUpperInvariant();
    }

    public static async Task SynthesizeToFileAsync(string text, string voice, string rateStr, string outputPath, CancellationToken cancellationToken = default)
    {
        var token = GenerateSecMsGecToken();
        var connectionId = Guid.NewGuid().ToString("N");
        var wsUri = new Uri($"wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken={TrustedClientToken}&Sec-MS-GEC={token}&Sec-MS-GEC-Version=1-130.0.2849.68&ConnectionId={connectionId}");

        using var ws = new ClientWebSocket();
        ws.Options.SetRequestHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0");
        ws.Options.SetRequestHeader("Accept-Encoding", "gzip, deflate, br");
        ws.Options.SetRequestHeader("Accept-Language", "en-US,en;q=0.9");
        ws.Options.SetRequestHeader("Pragma", "no-cache");
        ws.Options.SetRequestHeader("Cache-Control", "no-cache");
        ws.Options.SetRequestHeader("Origin", "chrome-extension://jdiccldimpdaibmpdkgiklldnnnkfmnd");

        await ws.ConnectAsync(wsUri, cancellationToken);

        // 1. Send speech.config
        var configMsg = "Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}";
        var configBytes = Encoding.UTF8.GetBytes(configMsg);
        await ws.SendAsync(new ArraySegment<byte>(configBytes), WebSocketMessageType.Text, true, cancellationToken);

        // 2. Build SSML request
        var requestId = Guid.NewGuid().ToString("N");
        var ssml = $"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='{voice}'><prosody rate='{rateStr}' pitch='+0Hz'>{System.Security.SecurityElement.Escape(text)}</prosody></voice></speak>";
        var ssmlMsg = $"X-RequestId:{requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n{ssml}";
        var ssmlBytes = Encoding.UTF8.GetBytes(ssmlMsg);
        await ws.SendAsync(new ArraySegment<byte>(ssmlBytes), WebSocketMessageType.Text, true, cancellationToken);

        // 3. Receive audio stream
        using var fileStream = new FileStream(outputPath, FileMode.Create, FileAccess.Write, FileShare.None);
        var buffer = new byte[8192];
        var isTurnEnd = false;

        while (ws.State == WebSocketState.Open && !isTurnEnd)
        {
            using var ms = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    break;
                }
                ms.Write(buffer, 0, result.Count);
            } while (!result.EndOfMessage);

            if (result.MessageType == WebSocketMessageType.Close)
            {
                break;
            }

            var received = ms.ToArray();
            if (result.MessageType == WebSocketMessageType.Binary && received.Length >= 2)
            {
                // Binary messages have a 2-byte header length followed by headers and audio payload
                var headerLength = (received[0] << 8) | received[1];
                if (received.Length > headerLength + 2)
                {
                    fileStream.Write(received, headerLength + 2, received.Length - (headerLength + 2));
                }
            }
            else if (result.MessageType == WebSocketMessageType.Text)
            {
                var textMsg = Encoding.UTF8.GetString(received);
                if (textMsg.Contains("Path:turn.end", StringComparison.OrdinalIgnoreCase))
                {
                    isTurnEnd = true;
                }
            }
        }

        try
        {
            if (ws.State == WebSocketState.Open)
            {
                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Complete", cancellationToken);
            }
        }
        catch
        {
            // Ignore normal close race
        }
    }
}
