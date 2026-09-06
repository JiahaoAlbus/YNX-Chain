using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;

namespace YNXDeveloper;

internal static class ProfileStorage
{
    public static string Root => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "YNXDeveloper");
    public static string Stable => Path.Combine(Root, "WebView2");
    public static string Legacy => (Environment.ProcessPath ?? throw new IOException("Executable path unavailable.")) + ".WebView2";
    public static async Task CopyLegacy(string source, string destination)
    {
        await Task.Run(() =>
        {
            source = Path.GetFullPath(source); destination = Path.GetFullPath(destination);
            if (!Directory.Exists(source) || Directory.Exists(destination) || destination.StartsWith(source + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Profile migration needs a closed existing profile and an absent destination.");
            var stage = destination + ".migration-" + Guid.NewGuid().ToString("N");
            var handles = new List<(string path, FileStream stream)>();
            try
            {
                var files = Inventory(source);
                if (!File.Exists(Path.Combine(source, "EBWebView", "Local State"))) throw new IOException("Select a WebView2 user-data folder containing EBWebView/Local State. No empty profile was created.");
                long total = 0;
                foreach (var path in files)
                {
                    // Retain every exclusive read handle until verification ends. A running WebView cannot be copied.
                    var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None);
                    handles.Add((path, stream)); total += stream.Length;
                    if (total > 4L * 1024 * 1024 * 1024) throw new IOException("Profile exceeds the 4 GiB migration limit; original retained.");
                }
                Directory.CreateDirectory(stage);
                foreach (var (path, stream) in handles)
                {
                    var target = Path.Combine(stage, Path.GetRelativePath(source, path)); Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                    using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { stream.CopyTo(output); output.Flush(true); }
                    stream.Position = 0; var originalHash = SHA256.HashData(stream);
                    using var copied = File.OpenRead(target);
                    if (!originalHash.SequenceEqual(SHA256.HashData(copied))) throw new IOException("Profile copy verification failed.");
                }
                if (!files.SequenceEqual(Inventory(source))) throw new IOException("Profile changed while migrating; original retained.");
                Directory.Move(stage, destination); // Atomic publication on the destination volume; source is never moved/deleted.
            }
            finally { foreach (var (_, stream) in handles) stream.Dispose(); }
            // A failed staging directory is deliberately retained for diagnosis; it is never treated as the active profile.
        });
    }
    static string[] Inventory(string root)
    {
        var files = new List<string>(); var pending = new Stack<string>(); pending.Push(root);
        while (pending.Count > 0)
        {
            var dir = pending.Pop();
            if ((File.GetAttributes(dir) & FileAttributes.ReparsePoint) != 0) throw new IOException("Profile links are not migrated.");
            foreach (var entry in Directory.EnumerateFileSystemEntries(dir))
            {
                var flags = File.GetAttributes(entry);
                if ((flags & FileAttributes.ReparsePoint) != 0) throw new IOException("Profile links are not migrated.");
                if ((flags & FileAttributes.Directory) != 0) pending.Push(entry); else files.Add(entry);
                if (files.Count + pending.Count > 20000) throw new IOException("Profile migration exceeds 20,000 entries.");
            }
        }
        return files.OrderBy(path => path, StringComparer.Ordinal).ToArray();
    }
    internal record Geometry(double Left, double Top, double Width, double Height);
    public static async Task<Geometry?> ReadGeometry(string path, Rect workArea)
    {
        try
        {
            return await Task.Run(() =>
            {
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                if (stream.Length > 4096) return null;
                var value = JsonSerializer.Deserialize<Geometry>(stream);
                return value == null ? null : Clamp(value, workArea);
            });
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException) { return null; }
    }
    public static Geometry? Clamp(Geometry value, Rect area)
    {
        if (!new[] { value.Left, value.Top, value.Width, value.Height }.All(double.IsFinite) || value.Width <= 0 || value.Height <= 0) return null;
        var width = Math.Min(Math.Max(960, value.Width), Math.Max(1, area.Width));
        var height = Math.Min(Math.Max(640, value.Height), Math.Max(1, area.Height));
        return new(Math.Clamp(value.Left, area.Left, Math.Max(area.Left, area.Right - width)), Math.Clamp(value.Top, area.Top, Math.Max(area.Top, area.Bottom - height)), width, height);
    }
    public static async Task WriteAtomic(string path, string content)
    {
        await Task.Run(() =>
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temporary = path + ".tmp-" + Guid.NewGuid().ToString("N");
            try
            {
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (var writer = new StreamWriter(stream, new System.Text.UTF8Encoding(false))) { writer.Write(content); writer.Flush(); stream.Flush(true); }
                File.Move(temporary, path, true);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        });
    }
}
