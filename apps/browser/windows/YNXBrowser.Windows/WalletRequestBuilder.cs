using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace YNXBrowser.Windows;

internal static class WalletRequestBuilder
{
    internal const string ProductClientId = "ynx-browser-windows";
    internal const string RequestingProduct = "browser";
    internal const string BundleId = "com.ynxweb4.browser.windows";
    internal const string Callback = "ynxbrowser://com.ynxweb4.browser.windows/auth/callback";
    internal const string ProductDeviceAlgorithm = "p256-sha256";
    internal const string ChainId = "ynx_6423-1";
    private const string DeviceKeyName = "YNXBrowserDeviceP256";
    private static readonly string[] Scopes = ["account:read", "browser:wallet-request"];
    private static readonly string PendingPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "YNXBrowser",
        "wallet-request.json");

    internal static Uri CreateAuthorizationUri(DateTimeOffset? nowOverride = null)
    {
        var issuedAt = nowOverride ?? DateTimeOffset.UtcNow;
        var expiresAt = issuedAt.AddMinutes(5);
        var nonce = Base64Url(RandomNumberGenerator.GetBytes(32));
        using var deviceKey = OpenDeviceKey();
        var request = new WalletAuthorizationRequest(
            "1",
            nonce,
            ChainId,
            RequestingProduct,
            ProductClientId,
            BundleId,
            ProductDeviceAlgorithm,
            CompressedPublicKey(deviceKey),
            Callback,
            Scopes,
            "Sign in to YNX Browser",
            issuedAt.ToUniversalTime().ToString("O"),
            expiresAt.ToUniversalTime().ToString("O"));
        var pending = CreatePendingRequest(request, deviceKey);
        Directory.CreateDirectory(Path.GetDirectoryName(PendingPath)!);
        WriteAtomic(PendingPath, JsonSerializer.Serialize(pending, JsonOptions));
        var encodedRequest = Base64Url(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request, JsonOptions)));
        return new Uri($"ynxwallet://authorize?request={Uri.EscapeDataString(encodedRequest)}");
    }

    internal static string ValidateCallback(Uri callback, DateTimeOffset? nowOverride = null)
    {
        if (!string.Equals(callback.Scheme, "ynxbrowser", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(callback.Host, "com.ynxweb4.browser.windows", StringComparison.Ordinal) ||
            !string.Equals(callback.AbsolutePath, "/auth/callback", StringComparison.Ordinal) ||
            !string.IsNullOrEmpty(callback.Fragment) ||
            !string.IsNullOrEmpty(callback.UserInfo))
        {
            throw new SecurityException("Wallet callback route mismatch");
        }

        var pending = ReadPendingRequest();
        using var deviceKey = OpenDeviceKey();
        VerifyPendingRequest(pending, deviceKey);
        var now = nowOverride ?? DateTimeOffset.UtcNow;
        if (!DateTimeOffset.TryParse(pending.ExpiresAt, out var expiresAt) || expiresAt <= now)
        {
            DeletePendingRequest();
            throw new SecurityException("Wallet request expired");
        }

        var query = QueryValues(callback);
        if (query.Count != 1 || !query.TryGetValue("response", out var encodedResponse) || string.IsNullOrEmpty(encodedResponse))
        {
            throw new SecurityException("Wallet callback query mismatch");
        }
        WalletAuthorizationResponse response;
        try
        {
            response = JsonSerializer.Deserialize<WalletAuthorizationResponse>(Encoding.UTF8.GetString(DecodeBase64Url(encodedResponse)), JsonOptions)
                ?? throw new SecurityException("Wallet response is empty");
        }
        catch (JsonException error)
        {
            throw new SecurityException("Wallet response is malformed", error);
        }

        if (!string.Equals(response.Nonce, pending.Nonce, StringComparison.Ordinal) ||
            !string.Equals(response.ChainId, ChainId, StringComparison.Ordinal) ||
            !string.Equals(response.ProductClientId, ProductClientId, StringComparison.Ordinal) ||
            !string.Equals(response.BundleId, BundleId, StringComparison.Ordinal))
        {
            throw new SecurityException("Wallet response binding mismatch");
        }

        DeletePendingRequest();
        return "Wallet response received. Gateway signature and device challenge verification are required; no Product Session was created locally.";
    }

    private static PendingWalletRequest CreatePendingRequest(WalletAuthorizationRequest request, ECDsa deviceKey)
    {
        var payload = PendingPayload(request.Nonce, request.ExpiresAt);
        var signature = Base64Url(deviceKey.SignData(payload, HashAlgorithmName.SHA256));
        return new PendingWalletRequest(
            request.Nonce,
            request.ExpiresAt,
            request.ChainId,
            request.ProductClientId,
            request.BundleId,
            request.Callback,
            request.Scopes,
            signature);
    }

    private static PendingWalletRequest ReadPendingRequest()
    {
        try
        {
            return JsonSerializer.Deserialize<PendingWalletRequest>(File.ReadAllText(PendingPath), JsonOptions)
                ?? throw new SecurityException("Wallet request state is empty");
        }
        catch (FileNotFoundException error)
        {
            throw new SecurityException("Wallet request state is missing or already consumed", error);
        }
        catch (JsonException error)
        {
            throw new SecurityException("Wallet request state is malformed", error);
        }
    }

    private static void VerifyPendingRequest(PendingWalletRequest pending, ECDsa deviceKey)
    {
        var exact = string.Equals(pending.ChainId, ChainId, StringComparison.Ordinal) &&
            string.Equals(pending.ProductClientId, ProductClientId, StringComparison.Ordinal) &&
            string.Equals(pending.BundleId, BundleId, StringComparison.Ordinal) &&
            string.Equals(pending.Callback, Callback, StringComparison.Ordinal) &&
            pending.Scopes.SequenceEqual(Scopes, StringComparer.Ordinal);
        var signatureValid = false;
        try
        {
            signatureValid = deviceKey.VerifyData(PendingPayload(pending.Nonce, pending.ExpiresAt), DecodeBase64Url(pending.Signature), HashAlgorithmName.SHA256);
        }
        catch (FormatException)
        {
            signatureValid = false;
        }
        if (!exact || !signatureValid) throw new SecurityException("Wallet request state was tampered");
    }

    private static byte[] PendingPayload(string nonce, string expiresAt) => Encoding.UTF8.GetBytes(string.Join('\n',
        "YNX_BROWSER_WINDOWS_WALLET_REQUEST_V1",
        nonce,
        expiresAt,
        ChainId,
        ProductClientId,
        BundleId,
        Callback,
        string.Join('\n', Scopes)));

    private static ECDsa OpenDeviceKey()
    {
        var provider = CngProvider.MicrosoftSoftwareKeyStorageProvider;
        if (!CngKey.Exists(DeviceKeyName, provider))
        {
            using var created = CngKey.Create(CngAlgorithm.ECDsaP256, DeviceKeyName, new CngKeyCreationParameters
            {
                Provider = provider,
                KeyCreationOptions = CngKeyCreationOptions.None,
                KeyUsage = CngKeyUsages.Signing,
                ExportPolicy = CngExportPolicies.None
            });
        }
        return new ECDsaCng(CngKey.Open(DeviceKeyName, provider, CngKeyOpenOptions.None));
    }

    private static string CompressedPublicKey(ECDsa deviceKey)
    {
        var point = deviceKey.ExportParameters(false).Q;
        if (point.X is not { Length: 32 } || point.Y is not { Length: 32 })
        {
            throw new SecurityException("Windows product device key is not P-256");
        }
        var compressed = new byte[33];
        compressed[0] = (byte)((point.Y[^1] & 1) == 0 ? 2 : 3);
        Buffer.BlockCopy(point.X, 0, compressed, 1, point.X.Length);
        return Base64Url(compressed);
    }

    private static void WriteAtomic(string path, string text)
    {
        var temporary = $"{path}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
        File.WriteAllText(temporary, text, new UTF8Encoding(false));
        File.Move(temporary, path, true);
    }

    private static void DeletePendingRequest()
    {
        try { File.Delete(PendingPath); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static Dictionary<string, string> QueryValues(Uri uri)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var entry in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = entry.Split('=', 2);
            var name = Uri.UnescapeDataString(parts[0]);
            var value = parts.Length == 2 ? Uri.UnescapeDataString(parts[1]) : string.Empty;
            if (!values.TryAdd(name, value)) throw new SecurityException("Wallet callback contains a duplicate query field");
        }
        return values;
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] DecodeBase64Url(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized += (normalized.Length % 4) switch { 2 => "==", 3 => "=", 0 => "", _ => throw new FormatException("Invalid base64url length") };
        return Convert.FromBase64String(normalized);
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };

    private sealed record WalletAuthorizationRequest(
        string Version,
        string Nonce,
        string ChainId,
        string RequestingProduct,
        string ProductClientId,
        string BundleId,
        string ProductDeviceAlgorithm,
        string ProductDeviceKey,
        string Callback,
        IReadOnlyList<string> Scopes,
        string Purpose,
        string IssuedAt,
        string ExpiresAt);

    private sealed record PendingWalletRequest(
        string Nonce,
        string ExpiresAt,
        string ChainId,
        string ProductClientId,
        string BundleId,
        string Callback,
        IReadOnlyList<string> Scopes,
        string Signature);

    private sealed record WalletAuthorizationResponse(
        [property: JsonPropertyName("nonce")] string Nonce,
        [property: JsonPropertyName("chainId")] string ChainId,
        [property: JsonPropertyName("productClientId")] string ProductClientId,
        [property: JsonPropertyName("bundleId")] string BundleId);
}
