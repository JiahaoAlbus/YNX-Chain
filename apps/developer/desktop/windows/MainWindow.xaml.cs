using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;

namespace YNXDeveloper;

public partial class MainWindow : Window
{
    readonly RoutedCommand exportCommand = new();
    readonly string statePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "YNXDeveloper", "window.json");
    Process? server;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += Start;
        Closing += Stop;
        CommandBindings.Add(new(ApplicationCommands.New, (_, _) => Click("#create-project")));
        CommandBindings.Add(new(ApplicationCommands.Open, (_, _) => Click("#import-project")));
        CommandBindings.Add(new(ApplicationCommands.Save, (_, _) => Save(null!, null!)));
        CommandBindings.Add(new(exportCommand, (_, _) => Click("#export-project")));
        InputBindings.Add(new KeyBinding(exportCommand, new KeyGesture(Key.S, ModifierKeys.Control | ModifierKeys.Shift)));
        RestoreWindow();
    }

    async void Start(object sender, RoutedEventArgs e)
    {
        try
        {
            var resources = Path.Combine(AppContext.BaseDirectory, "Resources");
            var runtime = Path.Combine(resources, "runtime", "node.exe");
            var serverScript = Path.Combine(resources, "server.mjs");
            if (!File.Exists(runtime) || !File.Exists(serverScript)) throw new FileNotFoundException("The bundled Windows runtime or local server is missing.");
            var port = AvailableLoopbackPort();
            var start = new ProcessStartInfo(runtime) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = resources };
            start.ArgumentList.Add(serverScript);
            start.Environment["PORT"] = port.ToString();
            server = Process.Start(start) ?? throw new InvalidOperationException("The bundled local server did not start.");
            await WaitForServer(port);
            await Browser.EnsureCoreWebView2Async();
            Browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
            Browser.Source = new Uri($"http://127.0.0.1:{port}");
        }
        catch (Exception error)
        {
            MessageBox.Show($"YNX Developer could not cold start its bounded local server. No project, Wallet key, or deployment was changed.\n\n{error.Message}", "Testnet Preview startup failed", MessageBoxButton.OK, MessageBoxImage.Error);
            Close();
        }
    }

    static int AvailableLoopbackPort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    static async Task WaitForServer(int port)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(500) };
        for (var attempt = 0; attempt < 60; attempt++)
        {
            try { if ((await client.GetAsync($"http://127.0.0.1:{port}/")).IsSuccessStatusCode) return; } catch (HttpRequestException) { }
            catch (TaskCanceledException) { }
            await Task.Delay(100);
        }
        throw new TimeoutException("The bundled local server did not become ready.");
    }

    async void Click(string selector) { if (Browser.CoreWebView2 != null) await Browser.ExecuteScriptAsync($"document.querySelector('{selector}')?.click()"); }
    void NewProject(object s, RoutedEventArgs e) => Click("#create-project");
    void OpenProject(object s, RoutedEventArgs e) => Click("#import-project");
    void ExportProject(object s, RoutedEventArgs e) => Click("#export-project");
    void Save(object s, RoutedEventArgs e) => Browser.CoreWebView2?.ExecuteScriptAsync("document.querySelector('#editor')?.dispatchEvent(new Event('input',{bubbles:true}))");
    void Reload(object s, RoutedEventArgs e) => Browser.Reload();
    void Exit(object s, RoutedEventArgs e) => Close();
    void CheckUpdates(object s, RoutedEventArgs e) => MessageBox.Show("This unsigned Testnet Preview never downloads or installs updates automatically. A production updater must verify an owner-signed manifest and package.", "Signed update boundary", MessageBoxButton.OK, MessageBoxImage.Information);
    void About(object s, RoutedEventArgs e) => MessageBox.Show("Unsigned Windows Testnet Preview. Not production signed or released.", "YNX Developer", MessageBoxButton.OK, MessageBoxImage.Information);
    void RestoreWindow() { try { var value = JsonSerializer.Deserialize<WindowStateRecord>(File.ReadAllText(statePath)); if (value != null) { Left = value.Left; Top = value.Top; Width = Math.Max(960, value.Width); Height = Math.Max(640, value.Height); } } catch { } }
    void Stop(object? sender, CancelEventArgs e) { Directory.CreateDirectory(Path.GetDirectoryName(statePath)!); File.WriteAllText(statePath, JsonSerializer.Serialize(new WindowStateRecord(Left, Top, Width, Height))); try { if (server is { HasExited: false }) server.Kill(true); } catch { } }
    record WindowStateRecord(double Left, double Top, double Width, double Height);
}
