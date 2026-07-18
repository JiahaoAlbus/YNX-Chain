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
            var runtime = Path.Combine(resources, "runtime", "node.exe");
            var server = Path.Combine(resources, "server.mjs");
            var web = Path.Combine(resources, "web", "index.html");
            if (!File.Exists(runtime) || !File.Exists(server) || !File.Exists(web)) return 2;

            var start = new ProcessStartInfo(runtime) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
            start.ArgumentList.Add("--version");
            using var node = Process.Start(start);
            if (node == null) return 3;
            var version = node.StandardOutput.ReadToEnd().Trim();
            node.WaitForExit(10_000);
            if (node.ExitCode != 0 || !version.StartsWith("v22.")) return 4;

            File.WriteAllText(evidencePath, JsonSerializer.Serialize(new
            {
                product = "YNX Developer Testnet Preview",
                runtime = version,
                resourcesVerified = true,
                signingClass = "unsigned",
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
