using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace YNXDeveloper;

// These checks also guard native-initiated script execution; there is no web-to-OS message handler.
internal static class HostPolicy
{
    public const int MaxProjectBytes = 2 * 1024 * 1024 + 256 * 1024;
    public const string WorkspaceSchema = "ynx-desktop-host/v1";
    public static bool CompatibleWorkspace(string? schema, string? source, string checkpoint, bool exactCheckpoint) =>
        schema == WorkspaceSchema && source is { Length: 40 } && source.All(Uri.IsHexDigit) &&
        (!exactCheckpoint || source == checkpoint);
    public static bool TrustedDocument(string? source) => Uri.TryCreate(source, UriKind.Absolute, out var uri) &&
        uri.Scheme == "https" && uri.Host == "developer.ynxweb4.com" && uri.Port == 443 && uri.UserInfo == "" &&
        (uri.AbsolutePath == "/" || uri.AbsolutePath == "/guest-workspace" || uri.AbsolutePath == "/wallet-auth/callback");
    // Hosted pages have ordinary browser authority only. Native file commands
    // still require TrustedDocument and the separate exact host contract.
    public static bool BrowserDocument(string? source) => Uri.TryCreate(source, UriKind.Absolute, out var uri) &&
        uri.Scheme == "https" && uri.Port == 443 && uri.UserInfo == "" && uri.HostNameType == UriHostNameType.Dns &&
        uri.Host.Contains('.') && !uri.Host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase) &&
        !uri.Host.EndsWith(".local", StringComparison.OrdinalIgnoreCase) && !uri.Host.EndsWith(".internal", StringComparison.OrdinalIgnoreCase);
    public static bool WalletPairNavigation(string? current, string? destination, bool userInitiated)
    {
        if (!userInitiated || !Uri.TryCreate(current, UriKind.Absolute, out var page) || page.Scheme != "https" || page.Host != "wallet-auth.ynxweb4.com" ||
            page.Port != 443 || page.UserInfo != "" || page.AbsolutePath != "/v2/browser-sessions/authorize" || destination == null ||
            !destination.StartsWith("ynxwallet://wc?uri=", StringComparison.Ordinal) || !Uri.TryCreate(destination, UriKind.Absolute, out var outer) || outer.Fragment != "") return false;
        var match = Regex.Match(outer.Query, @"^\?uri=([^&]+)$"); if (!match.Success) return false;
        string pairing; try { pairing = Uri.UnescapeDataString(match.Groups[1].Value); } catch { return false; }
        if (pairing.Length > 2048 || !Regex.IsMatch(pairing, @"^wc:[a-f0-9]{64}@2\?")) return false;
        var fields = pairing[(pairing.IndexOf('?') + 1)..].Split('&').Select(item => item.Split('=', 2)).ToArray();
        if (fields.Any(item => item.Length != 2) || fields.Select(item => item[0]).Distinct().Count() != fields.Length ||
            fields.Any(item => item[0] != "relay-protocol" && item[0] != "symKey" && item[0] != "expiryTimestamp")) return false;
        return fields.Any(item => item[0] == "relay-protocol" && item[1] == "irn") && fields.Any(item => item[0] == "symKey" && Regex.IsMatch(item[1], @"^[a-f0-9]{64}$")) &&
            fields.Where(item => item[0] == "expiryTimestamp").All(item => Regex.IsMatch(item[1], @"^[0-9]{1,12}$") && long.TryParse(item[1], out var expiry) && expiry > DateTimeOffset.UtcNow.ToUnixTimeSeconds());
    }
    public static bool EditCommand(string? command) => new[] { "selectAll", "undo", "redo", "cut", "copy", "paste" }.Contains(command);
    public static bool SafeRelativePath(string value) => value.Length is > 0 and <= 240 && !value.Contains("..") &&
        value.Split('/').All(part => part.Length > 0 && part != ".") && value.All(c => char.IsAsciiLetterOrDigit(c) || "_./ +@-".Contains(c));
    public static string PackagedSource()
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Resources", "build-provenance.json")));
            var value = doc.RootElement.GetProperty("sourceCommit").GetString() ?? "";
            return Regex.IsMatch(value, "^[a-f0-9]{40}$") ? value : "unverified";
        }
        catch (Exception) { return "unverified"; }
    }
    public static string PackagedVersion()
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Resources", "build-provenance.json")));
            var value = doc.RootElement.GetProperty("version").GetString() ?? "";
            return Regex.IsMatch(value, "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.-]+)?$") ? value : "unverified";
        }
        catch (Exception) { return "unverified"; }
    }
    public static string RuntimeCheckpoint()
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Resources", "build-provenance.json")));
        var value = doc.RootElement.GetProperty("runtimeCheckpoint").GetString() ?? "";
        if (value.Length != 40 || !value.All(Uri.IsHexDigit)) throw new InvalidDataException("Missing exact hosted runtime identity.");
        return value;
    }
    public static void SelfTest()
    {
        foreach (var rejected in new[] { "https://evil.example/", "https://developer.ynxweb4.com:444/", "http://developer.ynxweb4.com/", "https://user@developer.ynxweb4.com/", "https://developer.ynxweb4.com/runtime/previews/test/", "https://developer.ynxweb4.com.evil.test/", "about:blank" })
            if (TrustedDocument(rejected)) throw new Exception("Native source policy accepted " + rejected);
        if (!TrustedDocument(MainWindow.WorkspaceUrl) || !TrustedDocument(MainWindow.WorkspaceUrl + "wallet-auth/callback?code=test")) throw new Exception("Trusted document rejected.");
        foreach (var allowed in new[] { MainWindow.WorkspaceUrl + "projects", MainWindow.WorkspaceUrl + "sso/start", "https://wallet-auth.ynxweb4.com/", "https://01234567-1234-4321-8765-0123456789ab.runtime.example/" })
            if (!BrowserDocument(allowed) || TrustedDocument(allowed)) throw new Exception("Hosted navigation incorrectly gained native command authority.");
        foreach (var denied in new[] { "file:///tmp/private", "javascript:alert(1)", "http://runtime.example/", "https://user@runtime.example/", "https://runtime.example:444/", "https://127.0.0.1/", "https://localhost/", "https://runtime.local/", "about:blank" })
            if (BrowserDocument(denied)) throw new Exception("Unsafe hosted navigation accepted.");
        var pairing = "ynxwallet://wc?uri=" + Uri.EscapeDataString("wc:" + new string('a', 64) + "@2?relay-protocol=irn&symKey=" + new string('b', 64));
        var authorityPage = "https://wallet-auth.ynxweb4.com/v2/browser-sessions/authorize";
        if (!WalletPairNavigation(authorityPage, pairing, true) || WalletPairNavigation(authorityPage, pairing, false) || WalletPairNavigation(MainWindow.WorkspaceUrl, pairing, true) || WalletPairNavigation(authorityPage, pairing + "&extra=value", true))
            throw new Exception("Wallet Pair launch policy mismatch.");
        foreach (var value in new[] { "../x", "/x", "a//b", "C:\\x", "a\0b", "" }) if (SafeRelativePath(value)) throw new Exception("Unsafe file path accepted.");
        if (!SafeRelativePath("src/native-test.cpp") || EditCommand("run")) throw new Exception("Command policy mismatch.");
        var checkpoint = new string('a', 40); var updated = new string('b', 40);
        if (!CompatibleWorkspace(WorkspaceSchema, updated, checkpoint, false)) throw new Exception("Compatible hosted update disabled the installed client.");
        if (CompatibleWorkspace(WorkspaceSchema, updated, checkpoint, true)) throw new Exception("Acceptance allowed the wrong runtime checkpoint.");
        if (!CompatibleWorkspace(WorkspaceSchema, checkpoint, checkpoint, true)) throw new Exception("Exact acceptance checkpoint was rejected.");
        foreach (var source in new[] { "", "missing", new string('z', 40) })
            if (CompatibleWorkspace(WorkspaceSchema, source, checkpoint, false)) throw new Exception("Invalid runtime identity accepted.");
        if (CompatibleWorkspace("ynx-desktop-host/v2", updated, checkpoint, false)) throw new Exception("Unknown workspace command contract accepted.");
    }
}
