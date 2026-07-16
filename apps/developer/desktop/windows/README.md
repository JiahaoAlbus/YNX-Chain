# Windows Testnet Preview source

This WPF/WebView2 project is an independent `com.ynxweb4.developer.testnetpreview`
desktop source package with native menus and shortcuts, open/export integration,
window restoration, least-privilege `asInvoker` manifest, loopback-only product
server and an update boundary that refuses unsigned automatic updates. Copy the
built Web output and `desktop/server.mjs` under `Resources/` before publishing.

No Windows binary was built or cold-launched on the macOS development host. No
Authenticode signature, MSIX, installer or production release is claimed.
