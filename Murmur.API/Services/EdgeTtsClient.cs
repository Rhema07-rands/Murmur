using System.Buffers.Binary;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;

namespace Murmur.API.Services;

public static class EdgeTtsClient
{
    private const string TrustedClientToken = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
    private const string ChromiumFullVersion = "143.0.3650.75";
    private const string ChromiumMajorVersion = "143";
    private const string SecMsGecVersion = $"2-{ChromiumFullVersion}";
    private const long WindowsEpochOffsetSeconds = 11644473600L;

    private static readonly uint[] Sha256Initial =
    [
        0x6A09E667u, 0xBB67AE85u, 0x3C6EF372u, 0xA54FF53Au,
        0x510E527Fu, 0x9B05688Cu, 0x1F83D9ABu, 0x5BE0CD19u
    ];

    private static readonly uint[] Sha256State =
    [
        0xFD9FBEA2u, 0x91243CE7u, 0xBE499094u, 0xCD2E1E0Au,
        0x6C006F49u, 0x04BD35ABu, 0xFEB0A7E4u, 0x03EFFBD2u
    ];

    private static readonly uint[] Sha256Schedule =
    [
        0xEB24BF9Eu, 0x1558691Fu, 0xA0C09EE2u, 0x0CFA32BAu,
        0xA622EE8Cu, 0xD1DD9491u, 0xC0DD25A0u, 0xF9E70AB6u,
        0xF0C31573u, 0x7058CE4Eu, 0x7188E606u, 0x00E5AB33u,
        0xD258B060u, 0x72766564u
    ];

    private static readonly uint[] Sha256RoundConstants =
    [
        0x428A2F98u, 0x71374491u, 0xB5C0FBCFu, 0xE9B5DBA5u, 0x3956C25Bu, 0x59F111F1u, 0x923F82A4u, 0xAB1C5ED5u,
        0xD807AA98u, 0x12835B01u, 0x243185BEu, 0x550C7DC3u, 0x72BE5D74u, 0x80DEB1FEu, 0x9BDC06A7u, 0xC19BF174u,
        0xE49B69C1u, 0xEFBE4786u, 0x0FC19DC6u, 0x240CA1CCu, 0x2DE92C6Fu, 0x4A7484AAu, 0x5CB0A9DCu, 0x76F988DAu,
        0x983E5152u, 0xA831C66Du, 0xB00327C8u, 0xBF597FC7u, 0xC6E00BF3u, 0xD5A79147u, 0x06CA6351u, 0x14292967u,
        0x27B70A85u, 0x2E1B2138u, 0x4D2C6DFCu, 0x53380D13u, 0x650A7354u, 0x766A0ABBu, 0x81C2C92Eu, 0x92722C85u,
        0xA2BFE8A1u, 0xA81A664Bu, 0xC24B8B70u, 0xC76C51A3u, 0xD192E819u, 0xD6990624u, 0xF40E3585u, 0x106AA070u,
        0x19A4C116u, 0x1E376C08u, 0x2748774Cu, 0x34B0BCB5u, 0x391C0CB3u, 0x4ED8AA4Au, 0x5B9CCA4Fu, 0x682E6FF3u,
        0x748F82EEu, 0x78A5636Fu, 0x84C87814u, 0x8CC70208u, 0x90BEFFFAu, 0xA4506CEBu, 0xBEF9A3F7u, 0xC67178F2u
    ];

    private const uint Sha256Adjustment = 0xC9DC06A7u;
    private const uint Sha256Sigma0Adjustment = 0x059C0B80u;
    private const uint Sha256Sigma1Adjustment = 0x000B92C0u;

    private static readonly uint[] Sha256BlockConstants = BuildBlockConstants();

    private static readonly (uint Coeff, uint Offset)[] Cs64Coefficients =
    [
        (0xE82E91B1u, 0xB32700D0u),
        (0x44DE24C6u, 0x88DFF51Du),
        (0x3BEB65BCu, 0x29514038u),
        (0xC89C5933u, 0xB328CBDFu),
        (0x8D1EC211u, 0xD405B4D5u),
        (0x314EF5D5u, 0x26E55F3Cu),
        (0xE92491B1u, 0x607801C6u),
        (0xF0A5B9D5u, 0x82B2C1FBu),
        (0x06064CF3u, 0xFA51A3DAu),
        (0xDA79FA60u, 0x207CC464u),
        (0xBED20560u, 0x3C3C74F3u),
        (0x89F9C9F8u, 0xD2D14B61u),
        (0x35FA38C6u, 0xBB04A2C1u),
        (0xCB49E3C6u, 0xC5626167u)
    ];

    private const uint Cs64Factor = 0x82893933u;
    private const uint Cs64Adjustment0 = 0xF2F90B1Au;
    private const uint Cs64Adjustment1 = 0x0B1A0000u;

    private static uint[] BuildBlockConstants()
    {
        var arr = (uint[])Sha256RoundConstants.Clone();
        arr[14] = Sha256Adjustment;
        return arr;
    }

    private static uint Rol16(uint value) => (value << 16) | (value >> 16);

    private static uint Sigma0(uint value) =>
        (value >> 7) ^ (value << 25) ^ (value >> 18) ^ (value << 14) ^ (value >> 3);

    private static uint Sigma1(uint value) =>
        (value >> 17) ^ (value << 15) ^ (value >> 19) ^ (value << 13) ^ (value >> 10);

    private static void ExpandSha256Schedule(List<uint> words, int firstWord = 16)
    {
        for (var i = firstWord; i < 64; i++)
        {
            var x = words[i - 2];
            var y = words[i - 15];
            var s1 = (x >> 17) ^ (x << 15) ^ (x >> 19) ^ (x << 13) ^ (x >> 10);
            var s0 = (y >> 7) ^ (y << 25) ^ (y >> 18) ^ (y << 14) ^ (y >> 3);
            words.Add(unchecked(s1 + words[i - 7] + s0 + words[i - 16]));
        }
    }

    private static uint[] Sha256Rounds(uint[] state, List<uint> words, int firstRound = 0)
    {
        uint a = state[0], b = state[1], c = state[2], d = state[3];
        uint e = state[4], f = state[5], g = state[6], h = state[7];
        var constants = firstRound == 14 ? Sha256BlockConstants : Sha256RoundConstants;

        for (var i = firstRound; i < 64; i++)
        {
            ulong rotE = e * 0x100000001UL;
            ulong rotA = a * 0x100000001UL;
            uint s1 = (uint)((rotE >> 6) ^ (rotE >> 11) ^ (rotE >> 25));
            uint ch = g ^ (e & (f ^ g));
            uint t1 = unchecked(h + s1 + ch + constants[i] + words[i]);
            uint s0 = (uint)((rotA >> 2) ^ (rotA >> 13) ^ (rotA >> 22));
            uint maj = (a & b) | (c & (a | b));
            uint t2 = unchecked(s0 + maj);

            h = g;
            g = f;
            f = e;
            e = unchecked(d + t1);
            d = c;
            c = b;
            b = a;
            a = unchecked(t1 + t2);
        }

        return [a, b, c, d, e, f, g, h];
    }

    private static uint[] Sha256Init(ReadOnlySpan<byte> prefix7)
    {
        var words = new List<uint>(64);
        for (var i = 0; i < 14; i++) words.Add(0);
        uint w14 = ((uint)prefix7[0] << 16) | ((uint)prefix7[1] << 8) | prefix7[2];
        uint w15 = BinaryPrimitives.ReadUInt32BigEndian(prefix7.Slice(3, 4));
        words.Add(w14);
        words.Add(w15);

        for (var i = 16; i < 30; i++)
        {
            uint val = Sha256Schedule[i - 16];
            if (i - 2 >= 14)
            {
                val = unchecked(val + (i == 16 ? (Sigma1(words[i - 2]) ^ Sha256Sigma1Adjustment) : Sigma1(words[i - 2])));
            }
            if (i - 7 >= 14)
            {
                val = unchecked(val + words[i - 7]);
            }
            if (i - 15 >= 14)
            {
                val = unchecked(val + (i == 29 ? (Sigma0(words[i - 15]) ^ Sha256Sigma0Adjustment) : Sigma0(words[i - 15])));
            }
            words.Add(val);
        }

        uint w30 = unchecked(Sigma1(words[28]) + words[23] + Sigma0(words[15]) + words[14] + Sha256Adjustment - Sha256RoundConstants[14]);
        words.Add(w30);

        ExpandSha256Schedule(words, 31);
        var working = Sha256Rounds(Sha256State, words, 14);
        var res = new uint[8];
        for (var i = 0; i < 8; i++)
        {
            res[i] = unchecked(Sha256Initial[i] + working[i]);
        }
        return res;
    }

    private static byte[] ComputeCustomSha256Digest(byte[] data)
    {
        if (data.Length < 7)
        {
            throw new ArgumentException("Token data must contain at least 7 bytes.");
        }

        var length = 57 + data.Length;
        var padZeroCount = ((55 - length) % 64 + 64) % 64;
        var tail = data.AsSpan(7);
        var padded = new byte[tail.Length + 1 + padZeroCount + 8];
        tail.CopyTo(padded);
        padded[tail.Length] = 0x80;
        BinaryPrimitives.WriteUInt64BigEndian(padded.AsSpan(padded.Length - 8), (ulong)length * 8UL);

        var state = Sha256Init(data.AsSpan(0, 7));
        for (var offset = 0; offset < padded.Length; offset += 64)
        {
            var words = new List<uint>(64);
            for (var j = 0; j < 16; j++)
            {
                words.Add(BinaryPrimitives.ReadUInt32BigEndian(padded.AsSpan(offset + j * 4, 4)));
            }
            ExpandSha256Schedule(words);
            var working = Sha256Rounds(state, words);
            for (var i = 0; i < 8; i++)
            {
                state[i] = unchecked(state[i] + working[i]);
            }
        }

        var digest = new byte[32];
        for (var i = 0; i < 8; i++)
        {
            BinaryPrimitives.WriteUInt32BigEndian(digest.AsSpan(i * 4, 4), state[i]);
        }
        return digest;
    }

    private static List<uint> WordsLe4Even(byte[] data)
    {
        var padLen = ((-data.Length) % 4 + 4) % 4;
        var padded = new byte[data.Length + padLen];
        data.CopyTo(padded, 0);

        var words = new List<uint>(padded.Length / 4 + 1);
        for (var i = 0; i < padded.Length; i += 4)
        {
            words.Add(BinaryPrimitives.ReadUInt32LittleEndian(padded.AsSpan(i, 4)));
        }
        if (words.Count % 2 != 0)
        {
            words.Add(0);
        }
        return words;
    }

    private static (uint W0, uint W1) ComputeCs64Digest(byte[] data, byte[] digest)
    {
        uint keyA = BinaryPrimitives.ReadUInt32LittleEndian(digest.AsSpan(0, 4)) | 1u;
        uint keyB = BinaryPrimitives.ReadUInt32LittleEndian(digest.AsSpan(4, 4)) | 1u;

        uint factor0 = unchecked(keyA * Cs64Factor);
        uint factor1 = unchecked(keyB * Cs64Factor);

        var terms = new List<uint>(Cs64Coefficients.Length + data.Length / 2 + 4);
        var offsets = new List<uint>(Cs64Coefficients.Length + data.Length / 2 + 4);

        for (var i = 0; i < Cs64Coefficients.Length; i++)
        {
            terms.Add(unchecked(Cs64Coefficients[i].Coeff * (i % 2 == 0 ? factor0 : factor1)));
            offsets.Add(Cs64Coefficients[i].Offset);
        }

        var prefixed = new byte[data.Length + 1];
        prefixed[0] = 0;
        data.CopyTo(prefixed, 1);

        var dataWords = WordsLe4Even(prefixed);
        for (var i = 0; i < dataWords.Count; i++)
        {
            uint word = dataWords[i];
            uint term = unchecked(word * (i % 2 == 0 ? keyA : keyB));
            uint offset = unchecked(Rol16(word) * (i % 2 == 0 ? 0xEF0569FBu : 0xC31713DBu));
            if (i == 0)
            {
                term = unchecked(term + Cs64Adjustment0 * factor0);
                offset = unchecked(offset + Cs64Adjustment1);
            }
            terms.Add(term);
            offsets.Add(offset);
        }

        uint swapAcc = 0, swapLast = 0, state = 0, acc = 0;
        for (var i = 0; i < terms.Count; i += 2)
        {
            uint x = terms[i];
            uint y = terms[i + 1];

            uint t = Rol16(unchecked(offsets[i] + x));
            uint q = unchecked(t * 0x76F50F34u);
            swapAcc = unchecked(swapAcc + (Rol16(q) * 0xC3EFEA97u + q));

            t = Rol16(unchecked(offsets[i + 1] + y));
            q = unchecked(t * 0x1881CE3Cu);
            swapLast = unchecked(Rol16(q) * 0x35BD1EC9u + q);
            swapAcc = unchecked(swapAcc + swapLast);

            state = unchecked(state * keyA + x);
            state = unchecked(Rol16(state) * 0xCF98B111u);
            state = unchecked(Rol16(state) * 0x87085B9Fu);
            state = unchecked(Rol16(state) * 0x12CEB96Du);
            state = unchecked(Rol16(state) * 0x257E1D83u);
            acc = unchecked(acc + state);

            t = unchecked(state * keyB + y);
            t = unchecked(Rol16(t) * 0xA27416F5u);
            t = unchecked(Rol16(t) * 0xD38396FFu);
            state = unchecked(Rol16(unchecked(Rol16(t) * 0x7C932B89u)) * 0xBFA49F69u);
            acc = unchecked(acc + state);
        }

        return (swapLast ^ state, swapAcc ^ acc);
    }

    public static string GenerateSecMsGecToken(long? unixTimestampSeconds = null)
    {
        var unixSeconds = unixTimestampSeconds ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var ticks = unixSeconds + WindowsEpochOffsetSeconds;
        ticks -= ticks % 300;
        var fileTimeTicks = ticks * 10_000_000L;

        var data = Encoding.ASCII.GetBytes($"{fileTimeTicks}{TrustedClientToken}");
        var digest = ComputeCustomSha256Digest(data);
        var (w0, w1) = ComputeCs64Digest(data, digest);

        var cs64Bytes = new byte[8];
        BinaryPrimitives.WriteUInt32LittleEndian(cs64Bytes.AsSpan(0, 4), w0);
        BinaryPrimitives.WriteUInt32LittleEndian(cs64Bytes.AsSpan(4, 4), w1);

        return $"{Convert.ToHexString(cs64Bytes)}-{Convert.ToHexString(digest)}";
    }

    public static async Task SynthesizeToFileAsync(
        string text,
        string voice,
        string rateStr,
        string outputPath,
        CancellationToken cancellationToken = default)
    {
        var token = GenerateSecMsGecToken();
        var connectionId = Guid.NewGuid().ToString("N");
        var muid = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        var wsUri = new Uri(
            $"wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
            $"?TrustedClientToken={TrustedClientToken}" +
            $"&Sec-MS-GEC={token}" +
            $"&Sec-MS-GEC-Version={SecMsGecVersion}" +
            $"&ConnectionId={connectionId}");

        using var ws = new ClientWebSocket();
        ws.Options.SetRequestHeader("User-Agent",
            $"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{ChromiumMajorVersion}.0.0.0 Safari/537.36 Edg/{ChromiumMajorVersion}.0.0.0");
        ws.Options.SetRequestHeader("Accept-Encoding", "gzip, deflate, br, zstd");
        ws.Options.SetRequestHeader("Accept-Language", "en-US,en;q=0.9");
        ws.Options.SetRequestHeader("Pragma", "no-cache");
        ws.Options.SetRequestHeader("Cache-Control", "no-cache");
        ws.Options.SetRequestHeader("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold");
        ws.Options.SetRequestHeader("Cookie", $"muid={muid};");

        await ws.ConnectAsync(wsUri, cancellationToken);

        var configMsg =
            "Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" +
            "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}";
        await ws.SendAsync(Encoding.UTF8.GetBytes(configMsg), WebSocketMessageType.Text, true, cancellationToken);

        using var fileStream = new FileStream(outputPath, FileMode.Create, FileAccess.Write, FileShare.None);
        var chunks = ChunkText(text, 2500);
        var buffer = new byte[8192];

        foreach (var chunk in chunks)
        {
            var requestId = Guid.NewGuid().ToString("N");
            var ssml =
                $"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
                $"<voice name='{voice}'><prosody rate='{rateStr}' pitch='+0Hz'>" +
                $"{System.Security.SecurityElement.Escape(chunk)}" +
                $"</prosody></voice></speak>";
            var ssmlMsg = $"X-RequestId:{requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n{ssml}";
            await ws.SendAsync(Encoding.UTF8.GetBytes(ssmlMsg), WebSocketMessageType.Text, true, cancellationToken);

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

    private static List<string> ChunkText(string text, int maxChars)
    {
        var chunks = new List<string>();
        var remaining = text.Trim();
        while (remaining.Length > maxChars)
        {
            var splitAt = remaining.LastIndexOfAny(['.', '!', '?', '\n'], maxChars);
            if (splitAt <= 0)
            {
                splitAt = remaining.LastIndexOf(' ', maxChars);
            }
            if (splitAt <= 0)
            {
                splitAt = maxChars;
            }
            else
            {
                splitAt += 1;
            }

            chunks.Add(remaining[..splitAt].Trim());
            remaining = remaining[splitAt..].TrimStart();
        }
        if (remaining.Length > 0)
        {
            chunks.Add(remaining);
        }
        return chunks;
    }
}
