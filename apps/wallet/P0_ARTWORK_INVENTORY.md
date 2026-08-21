# Wallet P0 artwork inventory

This inventory records files actually present in the Wallet source. It does
not claim store approval or a complete cross-platform asset package.

| Requirement | Present source evidence | Status | Required next evidence |
| --- | --- | --- | --- |
| Android launcher icon | `android/app/src/main/res/mipmap-*/ic_launcher*.webp` | Source present | Independent visual review and source-vector provenance |
| Android splash | `android/app/src/main/res/drawable-*/splashscreen_logo.png` | Source present | Installer/download cover and original vector provenance |
| iOS app icon | `ios/YNXWallet/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png` | Source present | Physical-device screenshot and source-vector provenance |
| iOS launch screen | `ios/YNXWallet/SplashScreen.storyboard` | Source present | Physical-device launch capture |
| macOS `icns` | No macOS Wallet source | Not applicable to current product scope | Separate desktop Wallet scope |
| Windows `ico`/MSIX | No Windows Wallet source | Not applicable to current product scope | Separate desktop Wallet scope |
| PWA icons | No web custody runtime | Not applicable to current product scope | A separately approved web companion |
| Download / installer cover | Not present | Blocked | Design source, rendered asset, release artifact binding |
| Original vector source | Not present in Wallet source | Blocked | Wallet-specific original SVG/AI source plus SHA-256 registry entry |
| Current screenshots | Historical Wallet proof images in `proof/` | Evidence only | Version-bound Android/iOS screenshots for the P0 release |

No new logo or generic blue-square asset is introduced by this candidate. A
release cannot claim complete P0 artwork until the missing source-vector,
download/installer cover, and version-bound screenshots are delivered and
accepted by Integration.
