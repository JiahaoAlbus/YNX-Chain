using System;
using System.IO;
using System.Linq;
using System.Text.Json;

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
        (uri.AbsolutePath == "/" || uri.AbsolutePath == "/wallet-auth/callback");
    public static bool EditCommand(string? command) => new[] { "selectAll", "undo", "redo", "cut", "copy", "paste" }.Contains(command);
    public static bool SafeRelativePath(string value) => value.Length is > 0 and <= 240 && !value.Contains("..") &&
        value.Split('/').All(part => part.Length > 0 && part != ".") && value.All(c => char.IsAsciiLetterOrDigit(c) || "_./ +@-".Contains(c));
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
