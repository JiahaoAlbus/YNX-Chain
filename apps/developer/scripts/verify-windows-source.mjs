import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../desktop/windows/${path}`, import.meta.url), "utf8");
const [project, manifest, xaml, source, app] = await Promise.all([
  read("YNXDeveloper.TestnetPreview.csproj"), read("app.manifest"), read("MainWindow.xaml"), read("MainWindow.xaml.cs"), read("App.xaml"),
]);

assert.match(project, /<TargetFramework>net8\.0-windows<\/TargetFramework>/);
assert.match(project, /<UseWPF>true<\/UseWPF>/);
assert.match(project, /Microsoft\.Web\.WebView2/);
assert.match(manifest, /name="com\.ynxweb4\.developer\.testnetpreview"/);
assert.match(manifest, /requestedExecutionLevel level="asInvoker" uiAccess="false"/);
assert.match(app, /ShutdownMode="OnMainWindowClose"/);
for (const action of ["NewProject", "OpenProject", "Save", "ExportProject", "Reload", "CheckUpdates"]) assert.match(xaml, new RegExp(`Click="${action}"`));
assert.match(source, /Path\.Combine\(resources, "runtime", "node\.exe"\)/);
assert.match(source, /new TcpListener\(IPAddress\.Loopback, 0\)/);
assert.match(source, /http:\/\/127\.0\.0\.1:/);
assert.match(source, /WaitForServer/);
assert.match(source, /AreDevToolsEnabled = false/);
assert.match(source, /server\.Kill\(true\)/);
assert.match(source, /owner-signed manifest and package/);
assert.doesNotMatch(project + manifest + xaml + source + app, /OPENAI_API_KEY|privateKey|mnemonic|seed phrase|production release is signed/i);

console.log("Windows WPF/WebView2 source boundary check passed; no Windows build or cold launch is claimed on this macOS host.");
