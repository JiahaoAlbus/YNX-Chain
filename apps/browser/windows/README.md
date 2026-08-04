# YNX Browser for Windows

Native WPF desktop shell using Microsoft's mature Chromium-based WebView2 runtime. It includes multi-window-ready tab state, normal-session restart recovery, private-profile separation and cleanup, site permission review, downloads, file picker support supplied by WebView2, keyboard shortcuts, renderer recovery, bookmarks, and local-data clearing.

The Windows Wallet boundary now constructs the reviewed `ynx-browser-windows` authorization tuple with an operating-system CNG P-256 device key. The private key is non-exportable. Pending Nonce/expiry/product/callback/scope state is signed by that key before local persistence; callback state is single-use, exact-bound and fail-closed. Browser only launches Wallet review and validates the local callback envelope. Gateway signature and device-challenge verification remain mandatory, and Browser never signs a transaction or creates an authoritative Product Session.

Build with `dotnet build YNXBrowser.Windows/YNXBrowser.Windows.csproj` on Windows with the .NET 8 SDK. This repository does not claim a built or signed Windows package until that command, protocol registration, install/cold-start testing and an MSIX signing pipeline run on Windows. The current macOS workspace does not have `dotnet`, so the new Windows source is contract-tested but the binary is not verified.

Updates are deliberately outside the app process: only a future signed MSIX/App Installer feed may update the app. Web content and AI responses cannot replace binaries.
