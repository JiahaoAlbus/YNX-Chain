# Original YNX brand — source successor, 2026-10-03

The coordinator relayed the user's requirement to use the original YNX graphic at every product brand position, retaining the product name. All changes here remain in owned apps/developer.

## Exact originals and covered surfaces

The 798×420 transparent source is copied unchanged from the website owner's public/ynx-logo.png; SHA-256 df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d. Web home/login, guest/desktop-compatible Workbench, native project sidebar, Tools and recovery now use these bytes in nonshrinking contain containers with suitable spacing. The embedded favicon, legacy Studio icon and Tools activity image contain the same original bytes. The legacy Studio build uses this owned asset instead of a separate shared asset, and its crop wrapper no longer clips the graphic.

The native square original is copied unchanged from the d386 Wallet Android drawable; 1254×1254, SHA-256 38196080c2d56746fb37094abe68d1d89eabd8a2b29ab4f17bae48ac7e3effde. Committed 192 and 512 square app-icon derivatives use ordinary proportional sips scaling with the original padding. Their hashes are pinned in the native packager; they replace the older native icon inputs. Pass native/ynx-brand/ynx-icon-192.png as the packager's fifth input.

OpenVSCode's fixed titlebar position is verified against its exact upstream commit:
https://raw.githubusercontent.com/gitpod-io/openvscode-server/072586267e68ece9a47aa43f8c108e0dcbf44622/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css

The derived core recipe injects workbench-brand.css into the existing entry, replacing the titlebar app icon with the original graphic while retaining menu commands and provider/account icons. The reviewed manifest binds the injected style and graphic SHA-256. Derived runtime verification rejects a substituted image even if the manifest tree/style digests are updated. No native executor or rejected driver was installed or restarted.

Tools is 0.2.3, brand extension 0.1.1. prepareCoreProject derives the branding directory from its validated manifest version instead of replacing the old 0.1.0 bundle. Existing user files and old extension versions remain untouched.

## Validation and limits

TypeScript and the frontend production build passed using the existing cached dependencies, without installation. Twelve actual React/Chromium production-build checks cover 390px and 1440px signed-out home, signed-in home, locked recovery, guest Workbench/Monaco, signed-out Tools and signed-in Tools/Chain/AI forms. Each verifies served original PNG hash, natural dimensions, contain/flex behavior and on-screen bounds, and saves a screenshot. Backend identity/chain routes are controlled local fixtures with synthetic public data; they do not prove a real Wallet or business operation.

Screenshots and browser-receipt.json are in evidence/integration/ide-original-brand-20261003. Visual inspection covered the mobile authenticated home, mobile recovery and guest editor, desktop signed-out home and editor, and mobile signed-out/authenticated Tools. Service checks cover original-brand provenance and versioned installation preserving earlier bundles; the static workflow check also passed.

Current macOS/Windows shells consume the corrected Workbench content, but no current installer was built or installed. The actual full native OpenVSCode titlebar, public URL, installed desktop clients and real Wallet/business/capacity gates remain unverified. A owns formal packaging/publication and must recheck those exact entry/artifact versions after release. This source successor does not mark any formal release gate complete.
