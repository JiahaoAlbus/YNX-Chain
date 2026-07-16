# YNX Browser for Windows

Native WPF desktop shell using Microsoft's mature Chromium-based WebView2 runtime. It includes multi-window-ready tab state, normal-session restart recovery, private-profile separation and cleanup, site permission review, downloads, file picker support supplied by WebView2, keyboard shortcuts, renderer recovery, bookmarks, and local-data clearing.

Build with `dotnet build YNXBrowser.Windows/YNXBrowser.Windows.csproj` on Windows with the .NET 8 SDK. This repository does not claim a built or signed Windows package until that command and an MSIX signing pipeline run on Windows.

Updates are deliberately outside the app process: only a future signed MSIX/App Installer feed may update the app. Web content and AI responses cannot replace binaries.
