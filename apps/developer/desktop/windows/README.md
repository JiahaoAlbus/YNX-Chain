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
refusal without pretending that a macOS source check compiled or launched Windows.

No Windows binary was built or cold-launched on the macOS development host. No
Authenticode signature, MSIX, installer or production release is claimed.
