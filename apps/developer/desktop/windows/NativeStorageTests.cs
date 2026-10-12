using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;

namespace YNXDeveloper;

internal static class NativeStorageTests
{
    static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    public static async Task Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "ynx-native-storage-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        try
        {
            var source = Path.Combine(root, "legacy"); Directory.CreateDirectory(Path.Combine(source, "EBWebView"));
            var original = Path.Combine(source, "EBWebView", "Local State"); await File.WriteAllTextAsync(original, "original-profile-bytes");
            var destination = Path.Combine(root, "stable");
            using (var locked = new FileStream(original, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            {
                var rejected = false; try { await ProfileStorage.CopyLegacy(source, destination); } catch (IOException) { rejected = true; }
                Check(rejected && !Directory.Exists(destination), "Locked profile was published or replaced by an empty profile.");
            }
            await ProfileStorage.CopyLegacy(source, destination);
            Check(await File.ReadAllTextAsync(original) == "original-profile-bytes", "Migration altered original bytes.");
            Check(await File.ReadAllTextAsync(Path.Combine(destination, "EBWebView", "Local State")) == "original-profile-bytes", "Migrated bytes differ.");
            var overwriteRejected = false; try { await ProfileStorage.CopyLegacy(source, destination); } catch (IOException) { overwriteRejected = true; }
            Check(overwriteRejected, "Existing stable profile was overwritten.");
            var geometry = Path.Combine(root, "window.json");
            await ProfileStorage.WriteAtomic(geometry, "{broken");
            Check(await ProfileStorage.ReadGeometry(geometry, new Rect(0, 0, 1920, 1080)) == null, "Corrupt geometry was accepted.");
            Check(await File.ReadAllTextAsync(geometry) == "{broken", "Reading corrupt geometry changed it.");
            await ProfileStorage.WriteAtomic(geometry, new string('x', 4097));
            Check(await ProfileStorage.ReadGeometry(geometry, new Rect(0, 0, 1920, 1080)) == null, "Unbounded geometry accepted.");
            var clamped = ProfileStorage.Clamp(new(-99999, 99999, 99999, 99999), new Rect(0, 0, 1920, 1080));
            Check(clamped == new ProfileStorage.Geometry(0, 0, 1920, 1080), "Offscreen geometry was not clamped.");
            Check(ProfileStorage.Clamp(new(double.NaN, 0, 960, 640), new Rect(0, 0, 1920, 1080)) == null, "Nonfinite geometry accepted.");
            await ProfileStorage.WriteAtomic(geometry, "retained-on-write-failure");
            using (var locked = new FileStream(geometry, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                var rejected = false; try { await ProfileStorage.WriteAtomic(geometry, "replacement"); } catch (IOException) { rejected = true; }
                Check(rejected, "Locked geometry write unexpectedly succeeded.");
            }
            Check(await File.ReadAllTextAsync(geometry) == "retained-on-write-failure", "Failed atomic write lost original bytes.");
        }
        finally { Directory.Delete(root, true); }
    }
}
