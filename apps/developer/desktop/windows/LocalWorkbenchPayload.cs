using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;

namespace YNXDeveloper;

// Producer-input inspection only. This does NOT extract/launch the runtime or
// attest its installed tree, terminal ABI, WebView2 availability or isolation.
// No hosted URL or canonical grant substitutes for missing Windows inputs.
internal sealed record LocalWorkbenchPayload(string Archive, string Node, string TreeSha256, string NodeVersion)
{
    public static LocalWorkbenchPayload Inspect(string resources)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Windows runtime input inspection requires Windows.");
        var installed = Path.Combine(AppContext.BaseDirectory, "Resources");
        if (!Path.GetFullPath(resources).Equals(Path.GetFullPath(installed), StringComparison.OrdinalIgnoreCase))
            throw new IOException("Local runtime inputs must belong to this installed application.");
        RequireCanonical(resources, true);
        var payload = Path.Combine(resources, "composed-core");
        var distributionPath = Path.Combine(payload, "distribution.json");
        var pinPath = Path.Combine(payload, "workbench.pin.json");
        var archive = Path.Combine(payload, "workbench.tar");
        using var distributionDocument = ReadMetadata(distributionPath);
        using var pinDocument = ReadMetadata(pinPath);
        var distribution = distributionDocument.RootElement; var pin = pinDocument.RootElement;
        if (distribution.GetProperty("schemaVersion").GetInt32() != 1 ||
            distribution.GetProperty("archive").GetString() != "workbench.tar" ||
            !distribution.GetProperty("roundTripTreeVerified").GetBoolean()) throw new IOException("Windows workbench distribution is incomplete.");
        var local = distribution.GetProperty("localWorkspace");
        if (!local.GetProperty("enabled").GetBoolean() || local.GetProperty("identity").GetString() != "OS-user local project only" || local.GetProperty("canonicalAdmission").GetBoolean())
            throw new IOException("This payload is not sealed for local OS-user workspaces.");
        RequirePin(pin);
        var declared = distribution.GetProperty("runtimeArtifact"); RequirePin(declared);
        foreach (var key in new[] { "kind", "version", "architecture", "lockSha256", "treeSha256", "manifestSha256" })
            if (declared.GetProperty(key).GetString() != pin.GetProperty(key).GetString()) throw new IOException("Workbench distribution and pin disagree.");
        VerifyHash(archive, distribution.GetProperty("archiveSha256").GetString());
        var runtime = Path.Combine(resources, "runtime"), node = Path.Combine(runtime, "node.exe");
        using var nodeDocument = ReadMetadata(Path.Combine(runtime, "node-runtime.json"));
        var nodeReceipt = nodeDocument.RootElement;
        var version = nodeReceipt.GetProperty("nodeVersion").GetString() ?? "";
        if (nodeReceipt.GetProperty("schemaVersion").GetInt32() != 1 || nodeReceipt.GetProperty("architecture").GetString() != "win32-x64" ||
            !version.StartsWith("v26.", StringComparison.Ordinal) || distribution.GetProperty("requiredNodeVersion").GetString() != version)
            throw new IOException("An exact bundled Windows Node 26 runtime is required.");
        VerifyHash(node, nodeReceipt.GetProperty("sha256").GetString());
        // This currently missing producer receipt is an explicit required input,
        // not permission to reuse Darwin Node or download a replacement at startup.
        using var file = File.OpenRead(node); using var reader = new BinaryReader(file);
        if (file.Length < 64 || reader.ReadUInt16() != 0x5a4d) throw new IOException("Bundled Node is not a Windows executable.");
        file.Position = 0x3c; var pe = reader.ReadInt32();
        if (pe < 64 || pe > file.Length - 6) throw new IOException("Invalid Windows Node executable header.");
        file.Position = pe;
        if (reader.ReadUInt32() != 0x00004550 || reader.ReadUInt16() != 0x8664) throw new IOException("Bundled Node is not Windows x64.");
        return new LocalWorkbenchPayload(archive, node, pin.GetProperty("treeSha256").GetString()!, version);
    }
    static void RequirePin(JsonElement value)
    {
        var names = value.EnumerateObject().Select(item => item.Name).OrderBy(name => name, StringComparer.Ordinal).ToArray();
        if (!names.SequenceEqual(new[] { "architecture", "kind", "lockSha256", "manifestSha256", "treeSha256", "version" }) ||
            value.GetProperty("kind").GetString() != "ynx-theia" || value.GetProperty("version").GetString() != "1.76.0" || value.GetProperty("architecture").GetString() != "win32-x64")
            throw new IOException("An exact Windows x64 composed workbench pin is required.");
        foreach (var key in new[] { "lockSha256", "treeSha256", "manifestSha256" }) if (!Digest(value.GetProperty(key).GetString())) throw new IOException("Invalid workbench digest.");
    }
    static bool Digest(string? value) => value?.Length == 64 && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');
    static void VerifyHash(string path, string? expected)
    {
        RequireCanonical(path, false);
        if (!Digest(expected)) throw new IOException("Missing reviewed input digest.");
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > 4L * 1024 * 1024 * 1024) throw new IOException("Runtime input exceeds its bound.");
        var actual = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        if (actual != expected) throw new IOException("Bundled runtime input changed.");
    }
    static JsonDocument ReadMetadata(string path)
    {
        RequireCanonical(path, false);
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > 64 * 1024) throw new IOException("Runtime metadata exceeds its bound.");
        return JsonDocument.Parse(stream, new JsonDocumentOptions { MaxDepth = 16 });
    }
    internal static void RequireWithin(string path, string parent)
    {
        var full = Path.GetFullPath(path); var prefix = Path.GetFullPath(parent).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new IOException("Local profile is outside this OS user's YNX directory.");
    }
    internal static void RequireCanonical(string path, bool directory)
    {
        if (!Path.IsPathFullyQualified(path) || !Path.GetFullPath(path).Equals(path, StringComparison.OrdinalIgnoreCase)) throw new IOException("Canonical local path required.");
        var info = File.GetAttributes(path);
        if ((info & FileAttributes.ReparsePoint) != 0 || ((info & FileAttributes.Directory) != 0) != directory) throw new IOException("Links and incorrect local input types are refused.");
        for (var parent = Path.GetDirectoryName(path); !string.IsNullOrEmpty(parent); parent = Path.GetDirectoryName(parent))
            if ((File.GetAttributes(parent) & FileAttributes.ReparsePoint) != 0) throw new IOException("Local input ancestry contains a link.");
    }
}
