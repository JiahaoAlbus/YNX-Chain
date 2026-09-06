using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace YNXDeveloper;

// CLI-only test driver. It cannot address the ordinary user profile and exposes no browser message handler.
internal sealed class AcceptanceOptions
{
    public string Token { get; }
    public string Phase { get; }
    public string Evidence { get; }
    public string Profile => Path.Combine(ProfileStorage.Root, "QA", Token);
    public Dictionary<string, object?> Result { get; } = new();
    public bool? ConfirmNextImport { get; set; }
    public AcceptanceOptions(string token, string phase, string evidence)
    {
        if (!Guid.TryParseExact(token, "N", out _) || (phase != "write" && phase != "reopen")) throw new ArgumentException("Invalid isolated UI acceptance arguments.");
        Token = token; Phase = phase; Evidence = Path.GetFullPath(evidence);
        if (File.Exists(Evidence)) throw new IOException("Refusing to overwrite UI evidence.");
    }
    public string PrepareProfile()
    {
        var marker = Path.Combine(Profile, "ynx-qa-owner.json");
        if (Phase == "write")
        {
            if (Directory.Exists(Profile)) throw new IOException("Write phase requires a new isolated profile.");
            Directory.CreateDirectory(Profile); File.WriteAllText(marker, Token);
        }
        else if (!File.Exists(marker) || File.ReadAllText(marker) != Token) throw new IOException("Reopen requires the exact marked QA profile.");
        Result["phase"] = Phase; Result["profile"] = Profile; Result["token"] = Token;
        Result["runtimeCheckpoint"] = HostPolicy.RuntimeCheckpoint();
        Result["physicalMenuPickerUI"] = false;
        Result["splitDiffInstalledUI"] = false;
        return Profile;
    }
    public void ScriptDialog(object? sender, CoreWebView2ScriptDialogOpeningEventArgs args)
    {
        if (!HostPolicy.TrustedDocument(args.Uri) || args.Kind != CoreWebView2ScriptDialogKind.Confirm || !args.Message.StartsWith("Replace the current project with ", StringComparison.Ordinal) || ConfirmNextImport == null) return;
        if (ConfirmNextImport == true) args.Accept();
        ConfirmNextImport = null;
    }
    public async Task Finish(Exception? error)
    {
        Result["success"] = error == null; Result["error"] = error?.Message; Result["generatedAt"] = DateTimeOffset.UtcNow;
        await ProfileStorage.WriteAtomic(Evidence, JsonSerializer.Serialize(Result, new JsonSerializerOptions { WriteIndented = true }));
    }
}
internal static class NativeAcceptance
{
    const string Original = "// native menu fixture\nconst value = 42;\n";
    const string FileName = "native-menu.txt";
    static void Check(bool condition, string message) { if (!condition) throw new InvalidDataException(message); }
    static async Task<JsonElement> Export(MainWindow window)
    {
        var exported = await window.FileCommand("export-project");
        using var doc = JsonDocument.Parse(exported.GetProperty("content").GetString()!); return doc.RootElement.Clone();
    }
    static async Task ExpectContent(MainWindow window, string expected)
    {
        for (var attempt = 0; attempt < 60; attempt++)
        {
            var project = await Export(window);
            if (project.GetProperty("files").TryGetProperty(FileName, out var value) && value.GetString() == expected) return;
            await Task.Delay(100);
        }
        throw new InvalidDataException("Native editor command did not change the actual exported model to the expected content.");
    }
    static async Task FocusEditor(MainWindow window)
    {
        var result = await window.Evaluate("(()=>{const e=document.querySelector('.monaco-editor textarea.inputarea');if(!e)return false;e.focus();return document.activeElement===e})()");
        Check(result.ValueKind == JsonValueKind.True, "No actual Monaco textarea received focus.");
    }
    public static async Task Run(MainWindow window, AcceptanceOptions options)
    {
        // Ready is reached only after this WebView's top document, frontend bridge, editor and exact source health all agree.
        options.Result["webViewReady"] = true; options.Result["editorReady"] = true; options.Result["hostedWorkspaceConnected"] = true;
        var checkpointPath = Path.Combine(options.Profile, "ynx-qa-project.json");
        if (options.Phase == "reopen")
        {
            using var previous = JsonDocument.Parse(await File.ReadAllTextAsync(checkpointPath));
            var state = await window.Host(new { command = "state" });
            Check(state.GetProperty("state").GetProperty("projectId").GetString() == previous.RootElement.GetProperty("projectId").GetString(), "Reopen changed the project identity.");
            await ExpectContent(window, Original);
            Check((await Export(window)).GetProperty("files").TryGetProperty("created-from-native.txt", out _), "Native-created file did not survive reopening.");
            options.Result["sameProfileProjectRestored"] = true; return;
        }
        options.ConfirmNextImport = true;
        var fixture = JsonSerializer.Serialize(new { schemaVersion = "ynx-code-project/v1", name = "Native acceptance " + options.Token, files = new Dictionary<string, string> { [FileName] = Original } });
        MainWindow.RequireHandled(await window.FileCommand("import-project", "fixture.json", fixture));
        await ExpectContent(window, Original); options.Result["nativeImportModel"] = true;
        await FocusEditor(window); await window.EditCommand("selectAll"); await window.InsertText("x"); await ExpectContent(window, "x"); options.Result["nativeSelectAll"] = true;
        await window.EditCommand("undo"); await ExpectContent(window, Original); options.Result["nativeUndo"] = true;
        await window.EditCommand("redo"); await ExpectContent(window, "x"); options.Result["nativeRedo"] = true;
        await window.EditCommand("undo"); await ExpectContent(window, Original);
        await window.EditCommand("selectAll"); await window.EditCommand("copy"); await window.InsertText("x"); await ExpectContent(window, "x");
        await window.EditCommand("selectAll"); await window.EditCommand("paste"); await ExpectContent(window, Original); options.Result["nativeCopyPasteMultiline"] = true;
        await window.EditCommand("selectAll"); await window.EditCommand("cut"); await ExpectContent(window, "");
        await window.EditCommand("paste"); await ExpectContent(window, Original); options.Result["nativeCutPasteMultiline"] = true;
        // Reject a real confirm dialog while dirty, then prove the existing model is unchanged.
        await window.EditCommand("selectAll"); await window.InsertText("unsaved-dirty"); await ExpectContent(window, "unsaved-dirty");
        options.ConfirmNextImport = false;
        var cancelled = await window.FileCommand("import-project", "fixture.json", fixture);
        Check(cancelled.GetProperty("status").GetString() == "cancelled", "Import cancellation was not acknowledged.");
        await ExpectContent(window, "unsaved-dirty"); options.Result["cancelPreservesDirtyModel"] = true;
        var invalid = await window.Host(new { command = "import-project", filename = "invalid.json", content = "{\"schemaVersion\":\"ynx-code-project/v1\",\"name\":\"invalid\",\"files\":{\"../escape\":\"lost\"}}" });
        Check(invalid.GetProperty("status").GetString() == "failed", "Unsafe import was accepted."); await ExpectContent(window, "unsaved-dirty"); options.Result["invalidImportPreservesModel"] = true;
        await FocusEditor(window); await window.EditCommand("selectAll"); await window.InsertText(Original); await ExpectContent(window, Original);
        MainWindow.RequireHandled(await window.FileCommand("new-file", "created-from-native.txt")); options.Result["nativeNewFile"] = true;
        var saved = await window.FileCommand("save"); MainWindow.RequireHandled(saved);
        Check(saved.GetProperty("localSaved").GetBoolean(), "Save had no durable browser-profile acknowledgement.");
        options.Result["nativeLocalSaveAcknowledged"] = true; options.Result["remoteSaveAcknowledged"] = saved.GetProperty("remoteSaved").GetBoolean();
        var finalState = await window.Host(new { command = "state" });
        await ProfileStorage.WriteAtomic(checkpointPath, JsonSerializer.Serialize(new { projectId = finalState.GetProperty("state").GetProperty("projectId").GetString() }));
        options.Result["nativeCommandPipeline"] = true;
    }
}
