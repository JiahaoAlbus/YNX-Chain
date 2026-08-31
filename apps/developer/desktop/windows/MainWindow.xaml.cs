using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;

namespace YNXDeveloper;

public partial class MainWindow : Window
{
    readonly RoutedCommand exportCommand = new();
    readonly string statePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "YNXDeveloper", "window.json");
    public const string WorkspaceUrl = "https://developer.ynxweb4.com/";

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
            await WaitForWorkspace();
            await Browser.EnsureCoreWebView2Async();
            Browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
            Browser.Source = new Uri(WorkspaceUrl);
        }
        catch (Exception error)
        {
            MessageBox.Show($"YNX Developer could not connect to the verified hosted workspace. No project, Wallet key, or deployment was changed. Check the network and retry.\n\n{error.Message}", "Testnet Preview startup failed", MessageBoxButton.OK, MessageBoxImage.Error);
            Close();
        }
    }

    static async Task WaitForWorkspace()
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        for (var attempt = 0; attempt < 10; attempt++)
        {
            try
            {
                using var response = await client.GetAsync($"{WorkspaceUrl}healthz");
                if (response.IsSuccessStatusCode && (await response.Content.ReadAsStringAsync()).Contains("ynx-code-gateway")) return;
            }
            catch (HttpRequestException) { }
            catch (TaskCanceledException) { }
            await Task.Delay(500);
        }
        throw new TimeoutException("The hosted YNX Code gateway did not become ready.");
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
    void Stop(object? sender, CancelEventArgs e) { Directory.CreateDirectory(Path.GetDirectoryName(statePath)!); File.WriteAllText(statePath, JsonSerializer.Serialize(new WindowStateRecord(Left, Top, Width, Height))); }
    record WindowStateRecord(double Left, double Top, double Width, double Height);
}
