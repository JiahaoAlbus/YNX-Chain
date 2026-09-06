using System;
using System.ComponentModel;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace YNXDeveloper;

public partial class MainWindow : Window
{
    public const string WorkspaceUrl = "https://developer.ynxweb4.com/";
    readonly AcceptanceOptions? acceptance;
    readonly SemaphoreSlim menuLock = new(1, 1);
    long generation;
    bool ready, closing, closed;
    Mutex? profileLock;
    string profilePath = "", geometryPath = "";
    public MainWindow() : this(null) { }
    internal MainWindow(AcceptanceOptions? options)
    {
        acceptance = options;
        InitializeComponent(); Loaded += Start; Closing += Stop;
        Bind(ApplicationCommands.New, () => FileCommand("new-file"));
        Bind(ApplicationCommands.Open, () => FileCommand("import-project"));
        Bind(ApplicationCommands.Save, () => FileCommand("save"));
        Bind(ApplicationCommands.SelectAll, () => EditCommand("selectAll"));
        Bind(ApplicationCommands.Undo, () => EditCommand("undo"));
        Bind(ApplicationCommands.Redo, () => EditCommand("redo"));
        Bind(ApplicationCommands.Cut, () => EditCommand("cut"));
        Bind(ApplicationCommands.Copy, () => EditCommand("copy"));
        Bind(ApplicationCommands.Paste, () => EditCommand("paste"));
        var export = new RoutedCommand(); Bind(export, () => FileCommand("export-project"));
        InputBindings.Add(new KeyBinding(export, new KeyGesture(Key.S, ModifierKeys.Control | ModifierKeys.Shift)));
    }
    void Bind(ICommand command, Func<Task> action) => CommandBindings.Add(new CommandBinding(command, async (_, e) => { e.Handled = true; await RunMenu(action); }, (_, e) => { e.CanExecute = ready && !closing; e.Handled = true; }));
    async Task RunMenu(Func<Task> action)
    {
        if (!ready || closing || !await menuLock.WaitAsync(0)) return;
        try { await action(); }
        catch (Exception error) { Status.Text = error.Message; if (acceptance == null) MessageBox.Show(this, error.Message, "Command could not complete", MessageBoxButton.OK, MessageBoxImage.Warning); }
        finally { menuLock.Release(); }
    }
    async void Start(object sender, RoutedEventArgs e)
    {
        try
        {
            profilePath = acceptance?.PrepareProfile() ?? await SelectProfile();
            if (profilePath == "") { closed = true; Close(); return; }
            var lockId = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(profilePath).ToUpperInvariant())));
            profileLock = new Mutex(true, "Local\\YNXDeveloper-" + lockId, out var created);
            if (!created) throw new IOException("This workspace profile is already open. Close that YNX Developer window before reopening it.");
            geometryPath = Path.Combine(acceptance == null ? ProfileStorage.Root : profilePath, "window.json");
            var geometry = await ProfileStorage.ReadGeometry(geometryPath, SystemParameters.WorkArea);
            if (geometry != null) { Left = geometry.Left; Top = geometry.Top; Width = geometry.Width; Height = geometry.Height; }
            Status.Text = "Starting the workspace browser…";
            var environment = await CoreWebView2Environment.CreateAsync(null, profilePath);
            await Browser.EnsureCoreWebView2Async(environment);
            Browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
            Browser.CoreWebView2.Settings.AreHostObjectsAllowed = false;
            Browser.CoreWebView2.Settings.IsWebMessageEnabled = false;
            Browser.CoreWebView2.NavigationStarting += (_, args) =>
            {
                if (!HostPolicy.TrustedDocument(args.Uri)) { args.Cancel = true; Status.Text = "External navigation blocked. Workspace remains open."; return; }
                generation++; ready = false;
            };
            Browser.CoreWebView2.NewWindowRequested += (_, args) => { args.Handled = true; Status.Text = "Pop-up navigation is unavailable in this workspace window."; };
            Browser.CoreWebView2.NavigationCompleted += NavigationCompleted;
            Browser.CoreWebView2.ProcessFailed += (_, _) => { generation++; ready = false; Status.Text = "Workspace browser stopped. Saved profile is retained. Close and reopen to retry."; };
            if (acceptance != null) Browser.CoreWebView2.ScriptDialogOpening += acceptance.ScriptDialog;
            Browser.Source = new Uri(WorkspaceUrl);
        }
        catch (Exception error)
        {
            Status.Text = "Startup failed: " + error.Message;
            if (acceptance != null) await FinishAcceptance(error);
            else MessageBox.Show(this, error.Message + "\n\nExisting profile data is retained. Close and reopen to retry.", "Workspace startup failed", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }
    async Task<string> SelectProfile()
    {
        if (Directory.Exists(ProfileStorage.Stable)) return ProfileStorage.Stable;
        var answer = MessageBox.Show(this,
            "Choose how to open this installation.\n\nYes: copy an existing WebView2 profile from an earlier portable installation. Close the earlier app first; its original data will be retained.\nNo: explicitly create a new empty profile. This does not restore previous work.\nCancel: leave all data unchanged.",
            "Workspace profile", MessageBoxButton.YesNoCancel, MessageBoxImage.Question);
        if (answer == MessageBoxResult.Cancel) return "";
        if (answer == MessageBoxResult.Yes)
        {
            var picker = new OpenFolderDialog { Title = "Select the earlier executable’s .WebView2 folder", InitialDirectory = Directory.Exists(ProfileStorage.Legacy) ? ProfileStorage.Legacy : Path.GetDirectoryName(Environment.ProcessPath) ?? "" };
            if (picker.ShowDialog(this) != true) return "";
            Status.Text = "Copying and verifying the previous profile. Original data is retained…";
            await ProfileStorage.CopyLegacy(picker.FolderName, ProfileStorage.Stable);
        }
        else await Task.Run(() => Directory.CreateDirectory(ProfileStorage.Stable));
        return ProfileStorage.Stable;
    }
    async void NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        var expected = generation;
        try
        {
            if (!e.IsSuccess) throw new IOException("Workspace navigation failed: " + e.WebErrorStatus);
            for (var attempt = 0; attempt < 180; attempt++)
            {
                AssertDocument(expected);
                var state = await Host(new { command = "state" });
                if (state.TryGetProperty("state", out var value) && value.GetProperty("workspaceReady").GetBoolean() && (acceptance == null || value.GetProperty("editorReady").GetBoolean()))
                {
                    var identity = await Evaluate("(async()=>{const r=await fetch('/healthz',{cache:'no-store'});if(!r.ok)throw Error('Runtime identity unavailable');return await r.json()})()", expected);
                    if (identity.GetProperty("sourceCommit").GetString() != HostPolicy.RuntimeCheckpoint()) throw new IOException("Hosted runtime differs from this installer’s verified checkpoint. Update the installer before continuing.");
                    ready = true; Status.Text = "Workspace ready · " + HostPolicy.RuntimeCheckpoint()[..12];
                    CommandManager.InvalidateRequerySuggested();
                    if (acceptance != null) { await NativeAcceptance.Run(this, acceptance); await FinishAcceptance(null); }
                    return;
                }
                await Task.Delay(500);
            }
            throw new TimeoutException("The page did not expose a ready editor. Recovery dialogs and saved data have been left intact.");
        }
        catch (Exception error)
        {
            if (expected != generation || closed) return;
            ready = false; Status.Text = error.Message;
            if (acceptance != null) await FinishAcceptance(error);
        }
    }
    void AssertDocument(long expected)
    {
        if (closed || Browser.CoreWebView2 == null || expected != generation || !HostPolicy.TrustedDocument(Browser.CoreWebView2.Source)) throw new InvalidOperationException("Workspace document changed; command stopped.");
    }
    internal async Task<JsonElement> Evaluate(string expression, long? expectedGeneration = null)
    {
        var expected = expectedGeneration ?? generation; AssertDocument(expected);
        // Evaluates in the main frame only. No arbitrary expression is accepted from web content or native menu payloads.
        var guarded = "(async()=>{if(window.top!==window.self||location.origin!=='https://developer.ynxweb4.com'||!['/','/wallet-auth/callback'].includes(location.pathname))throw Error('Untrusted document');return await (" + expression + ")})()";
        var result = await Browser.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.evaluate", JsonSerializer.Serialize(new { expression = guarded, awaitPromise = true, returnByValue = true }));
        AssertDocument(expected);
        if (result.Length > HostPolicy.MaxProjectBytes * 8) throw new InvalidDataException("Workspace response too large.");
        using var doc = JsonDocument.Parse(result);
        if (doc.RootElement.TryGetProperty("exceptionDetails", out _)) throw new InvalidOperationException("Workspace command failed; no native fallback was executed.");
        if (!doc.RootElement.GetProperty("result").TryGetProperty("value", out var value)) throw new InvalidDataException("Workspace command returned no acknowledgement.");
        return value.Clone();
    }
    internal async Task<JsonElement> Host(object command)
    {
        return await Evaluate("(window.__ynxDesktopHost ? window.__ynxDesktopHost(" + JsonSerializer.Serialize(command) + ") : {status:'not-ready'})");
    }
    internal static void RequireHandled(JsonElement value)
    {
        if (value.GetProperty("status").GetString() != "handled") throw new IOException("Workspace did not accept the command: " + value.GetRawText()[..Math.Min(512, value.GetRawText().Length)]);
    }
    internal async Task<JsonElement> FileCommand(string command, string? path = null, string? content = null)
    {
        var expected = generation; AssertDocument(expected);
        if (command == "save") { var saved = await Host(new { command }); RequireHandled(saved); Status.Text = "Saved to this workspace profile."; return saved; }
        if (command == "new-file")
        {
            path ??= PromptPath();
            if (path == null) return JsonSerializer.SerializeToElement(new { status = "cancelled" });
            if (!HostPolicy.SafeRelativePath(path)) throw new InvalidDataException("Use a safe relative file path (up to 240 characters).");
            AssertDocument(expected); var created = await Host(new { command, path }); RequireHandled(created); return created;
        }
        if (command == "import-project")
        {
            if (content == null)
            {
                var dialog = new OpenFileDialog { Filter = "YNX project JSON (*.json)|*.json", CheckFileExists = true };
                if (dialog.ShowDialog(this) != true) return JsonSerializer.SerializeToElement(new { status = "cancelled" });
                path = dialog.FileName;
                content = await Task.Run(() =>
                {
                    using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                    if (file.Length > HostPolicy.MaxProjectBytes) throw new InvalidDataException("Project import exceeds the size limit.");
                    using var reader = new StreamReader(file, new UTF8Encoding(false, true), false); return reader.ReadToEnd();
                });
            }
            AssertDocument(expected);
            if (Encoding.UTF8.GetByteCount(content) > HostPolicy.MaxProjectBytes) throw new InvalidDataException("Project import exceeds the size limit.");
            var result = await Host(new { command, filename = Path.GetFileName(path ?? "project.json"), content });
            if (result.GetProperty("status").GetString() != "cancelled") RequireHandled(result);
            return result;
        }
        if (command == "export-project")
        {
            var result = await Host(new { command }); RequireHandled(result);
            if (acceptance != null) return result; // QA compares this exact model result; it does not pretend to exercise the picker.
            var dialog = new SaveFileDialog { FileName = Path.GetFileName(result.GetProperty("filename").GetString()), Filter = "YNX project JSON (*.json)|*.json" };
            if (dialog.ShowDialog(this) == true) { AssertDocument(expected); await ProfileStorage.WriteAtomic(dialog.FileName, result.GetProperty("content").GetString()!); }
            return result;
        }
        throw new InvalidOperationException("Unknown file command.");
    }
    string? PromptPath()
    {
        var input = new System.Windows.Controls.TextBox { Margin = new Thickness(16), MinWidth = 320 };
        var button = new System.Windows.Controls.Button { Content = "Create file", IsDefault = true, Margin = new Thickness(16), Padding = new Thickness(10) };
        var panel = new System.Windows.Controls.StackPanel(); panel.Children.Add(input); panel.Children.Add(button);
        var dialog = new Window { Owner = this, Title = "New file — relative path", Content = panel, SizeToContent = SizeToContent.WidthAndHeight, WindowStartupLocation = WindowStartupLocation.CenterOwner, ResizeMode = ResizeMode.NoResize };
        button.Click += (_, _) => dialog.DialogResult = true; dialog.Loaded += (_, _) => input.Focus();
        return dialog.ShowDialog() == true ? input.Text : null;
    }
    internal async Task EditCommand(string command)
    {
        if (!HostPolicy.EditCommand(command)) throw new InvalidOperationException("Unknown edit command.");
        var expected = generation; AssertDocument(expected);
        var route = await Evaluate("(()=>{const target=document.activeElement;const route=window.__ynxDesktopEdit?window.__ynxDesktopEdit(" + JsonSerializer.Serialize(command) + "): 'blocked';window.__ynxWindowsEditFocus=route==='native'?target:null;return route})()", expected);
        if (route.GetString() == "handled") return;
        if (route.GetString() != "native") throw new InvalidOperationException("Focus an editable text control to use this command.");
        AssertDocument(expected); Browser.Focus();
        var sameFocus = await Evaluate("Boolean(window.__ynxWindowsEditFocus&&window.__ynxWindowsEditFocus.isConnected&&window.__ynxWindowsEditFocus===document.activeElement)", expected);
        if (sameFocus.ValueKind != JsonValueKind.True) throw new InvalidOperationException("Text focus changed; command stopped.");
        // Exactly one browser keyboard chord; never global SendInput or an execCommand/model fallback.
        var key = command switch { "selectAll" => "A", "undo" => "Z", "redo" => "Y", "cut" => "X", "copy" => "C", "paste" => "V", _ => throw new InvalidOperationException() };
        await Browser.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", JsonSerializer.Serialize(new { type = "rawKeyDown", modifiers = 2, key = key.ToLowerInvariant(), code = "Key" + key, windowsVirtualKeyCode = (int)key[0] }));
        AssertDocument(expected);
        await Browser.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", JsonSerializer.Serialize(new { type = "keyUp", modifiers = 2, key = key.ToLowerInvariant(), code = "Key" + key, windowsVirtualKeyCode = (int)key[0] }));
        AssertDocument(expected);
    }
    async void NewFile(object s, RoutedEventArgs e) => await RunMenu(() => FileCommand("new-file"));
    async void OpenProject(object s, RoutedEventArgs e) => await RunMenu(() => FileCommand("import-project"));
    async void ExportProject(object s, RoutedEventArgs e) => await RunMenu(() => FileCommand("export-project"));
    async void Save(object s, RoutedEventArgs e) => await RunMenu(() => FileCommand("save"));
    async void Edit(object s, RoutedEventArgs e) { if (s is System.Windows.Controls.MenuItem item && item.Tag is string command) await RunMenu(() => EditCommand(command)); }
    async void Reload(object s, RoutedEventArgs e) => await RunMenu(async () => { RequireHandled(await FileCommand("save")); Browser.Reload(); });
    void Exit(object s, RoutedEventArgs e) => Close();
    void CheckUpdates(object s, RoutedEventArgs e) => MessageBox.Show("This Testnet Preview never downloads or installs updates automatically. A production updater must verify an owner-signed manifest and package.", "Update boundary");
    void About(object s, RoutedEventArgs e) => MessageBox.Show("Windows Testnet Preview. Not production signed or released.", "YNX Developer");
    async void Stop(object? sender, CancelEventArgs e)
    {
        if (closed) return;
        e.Cancel = true; if (closing) return; closing = true;
        try
        {
            if (ready) { await menuLock.WaitAsync(); try { RequireHandled(await FileCommand("save")); } finally { menuLock.Release(); } }
            var bounds = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds;
            if (geometryPath != "") try { await ProfileStorage.WriteAtomic(geometryPath, JsonSerializer.Serialize(new ProfileStorage.Geometry(bounds.Left, bounds.Top, bounds.Width, bounds.Height))); } catch (Exception error) { Status.Text = "Window position was not saved: " + error.Message; }
            if (acceptance != null) { acceptance.Result["normalCloseSaveAcknowledged"] = true; await acceptance.Finish(null); }
            closed = true; Browser.Dispose(); profileLock?.Dispose(); Close();
        }
        catch (Exception error) { closing = false; Status.Text = "Close paused because save was not acknowledged: " + error.Message; }
    }
    async Task FinishAcceptance(Exception? error)
    {
        if (acceptance == null || closed) return;
        if (error == null) { Close(); return; } // Exercise the ordinary Closing/save path on successful QA.
        await acceptance.Finish(error); ready = false; closed = true; Browser.Dispose(); profileLock?.Dispose();
        Application.Current.Shutdown(7);
    }
    internal async Task InsertText(string text)
    {
        var expected = generation; AssertDocument(expected);
        await Browser.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.insertText", JsonSerializer.Serialize(new { text })); AssertDocument(expected);
    }
}
