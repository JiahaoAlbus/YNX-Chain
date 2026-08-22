using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;

namespace YNXDeveloper;

public partial class App : Application
{
    void OnStartup(object sender, StartupEventArgs e)
    {
        if (e.Args.Length >= 3 && e.Args[0] == "--self-test")
        {
            Environment.ExitCode = SelfTest(e.Args[1], e.Args[2]);
            Shutdown(Environment.ExitCode);
            return;
        }

        MainWindow = new MainWindow();
        MainWindow.Show();
    }

    static int SelfTest(string resources, string evidencePath)
    {
        try
        {
            var provenance = Path.Combine(resources, "build-provenance.json");
            var sbom = Path.Combine(resources, "sbom.cdx.json");
            if (!File.Exists(provenance) || !File.Exists(sbom)) return 2;

            using var provenanceDocument = JsonDocument.Parse(File.ReadAllText(provenance));
            using var sbomDocument = JsonDocument.Parse(File.ReadAllText(sbom));
            var provenanceRoot = provenanceDocument.RootElement;
            if (provenanceRoot.GetProperty("productId").GetString() != "ynx-developer-v1" ||
                provenanceRoot.GetProperty("platform").GetString() != "windows-x64" ||
                provenanceRoot.GetProperty("signingClass").GetString() != "unsigned-no-authenticode" ||
                provenanceRoot.GetProperty("deliveryMode").GetString() != "hosted-workspace-client" ||
                provenanceRoot.GetProperty("workspaceUrl").GetString() != YNXDeveloper.MainWindow.WorkspaceUrl ||
                provenanceRoot.GetProperty("sourceDirty").GetBoolean()) return 2;
            var sourceCommit = provenanceRoot.GetProperty("sourceCommit").GetString();
            var runtimeCheckpoint = provenanceRoot.GetProperty("runtimeCheckpoint").GetString();
            if (string.IsNullOrWhiteSpace(sourceCommit) || string.IsNullOrWhiteSpace(runtimeCheckpoint)) return 2;

            File.WriteAllText(evidencePath, JsonSerializer.Serialize(new
            {
                product = "YNX Developer Testnet Preview",
                runtime = ".NET 8 WPF + WebView2 hosted workspace client",
                workspaceUrl = YNXDeveloper.MainWindow.WorkspaceUrl,
                resourcesVerified = true,
                signingClass = "unsigned-no-authenticode",
                sourceCommit,
                runtimeCheckpoint,
                generatedAt = DateTimeOffset.UtcNow
            }));
            return 0;
        }
        catch
        {
            return 5;
        }
    }
}
