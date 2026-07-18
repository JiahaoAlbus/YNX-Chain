# Windows Testnet Preview source

This WPF/WebView2 project is an independent `com.ynxweb4.developer.testnetpreview`
desktop source package with native menus and shortcuts, open/export integration,
window restoration, least-privilege `asInvoker` manifest, loopback-only product
server, bundled `Resources/runtime/node.exe` contract and an update boundary that
refuses unsigned automatic updates. Copy the built Web output, `desktop/server.mjs`
and a reviewed portable Windows Node runtime under `Resources/` before building.

`npm run desktop:windows-source-check` validates the project identity, WPF and
WebView2 configuration, `asInvoker` manifest, bounded loopback startup, bundled
runtime contract, native menu actions, window recovery and unsigned-update
refusal. It remains only a macOS structural check.

The separate `Developer Windows package proof` workflow performs the required
real-host boundary. Run `29658166198` at commit
`c6b4affc03b3255100516c34483096f445c46753` compiled the self-contained x64 App,
bundled Node `22.17.0` and the Web output, produced the unsigned portable ZIP,
extracted it, ran the packaged resource self-test, cold-launched the WPF App,
observed its bundled `node.exe`/`server.mjs` child, closed the main window and
verified child cleanup. ZIP SHA-256 is
`2899026250ecbbb28fc853cba291565bf792902b301f24280858cf4eb9098991`; size is
`106319108` bytes. The CI artifact has a 14-day retention and is not classified
as a public immutable download.

No Authenticode signature, MSIX/installer signature, public hosting or
production release is claimed.
