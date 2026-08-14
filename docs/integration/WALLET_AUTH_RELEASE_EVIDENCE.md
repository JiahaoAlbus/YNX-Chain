# Wallet/Auth platform release evidence

This is the central Integration view of platform delivery. The authoritative machine-readable record is `release/integration/wallet-auth-release-evidence-matrix.json`; it consumes Owner evidence without redefining Core network facts or Wallet/Auth protocol.

## Frozen snapshot

| Surface | Accepted direct boundary | Explicitly not promoted |
| --- | --- | --- |
| Gateway | Public Testnet authorization lifecycle, proof signing, replay rejection and revoke | Asset transaction, reconnect, native deployment, production signing, store release |
| Web PWA | Exact pushed proof for Edge-local install, visible first/second windows, live `0x1917` RPC and fail-closed provider identity invalidation | Cold process launch, registered callback, real-provider reconnect, public hosting |
| Browser extensions | Unsigned bundles hosted on official YNX URLs; Firefox temporary first/second launch; Edge popup RPC `0x1917`; isolated-profile MV3 tests | installedLocal, popup/background, live provider connect/account/sign/tx, production signing and store listing |
| Android API 36 | Current-source disposable-QA build/install/two cold launches, strong-biometric negative/positive input behavior, background relock and bounded authorization fail-close; prior source/audit/mutation tests | terminal replay/process restart, authoritative balance/nonce, persistent/production signature, hosted artifact, sign/tx/callback/reconnect |
| iOS Simulator | Run 31766659407: ad-hoc Simulator install, cold PID 25811, second PID 26098, callback PID 34080, malformed callback delivered then rejected | Testnet, physical device, successful authorization, signing, tx, reconnect, public hosting, production/store |
| macOS Wallet Universal | Run 31769976021: x86_64+arm64 ad-hoc package; arm64 install/cold/second, two callback rejections, Keychain canary and recovery absence before/after biometric-unavailable attempt | x86_64 lifecycle, authorization/recovery success, Testnet, Universal Link, signing/tx, Developer ID, notarization, public hosting/store |
| Linux/Windows desktop x64 | Current-HEAD native CI build/install/cold/second launch and exact Testnet read | Wallet signing, transaction, reconnect, hosted download, production signature |
| macOS desktop x64 | Native CI upgrade/install/cold/second launch, exact Testnet read and DMG/ZIP post-upload hash verification | Packages remain unsigned/unnotarized; hosted download, production signature and store release |
| Linux desktop arm64 AppImage | Native arm64 portable cold/second lifecycle, exact Testnet read and post-upload hash verification | installedLocal/installedNativeCI false; hosted download, production signature and store release |
| Linux desktop arm64 deb | Native CI install, upgrade, cold/second lifecycle, exact Testnet read, fail-close, uninstall and redownload hash | installedLocal false; unsigned, non-hosted and not store released |
| Linux desktop arm64 RPM | Fedora 42 arm64 DNF and RPM scripts; install/upgrade, sandbox, GUI lifecycle, Testnet/fail-close/uninstall/hash | rollback not tested; installedLocal/signing/hosting/store false |
| Windows desktop arm64 | Windows 11 arm64 native CI install/upgrade, cold/second lifecycle, exact Testnet read, fail-close, uninstall and readback hash | installedLocal false; Authenticode NotSigned, non-hosted and not store released |
| Windows CLI arm64 | Run 31770348463: Windows 11 arm64 upgrade/install/cold/second, frozen vectors, temporary P-256 self-test, exact `0x1917`, fail-close, uninstall and hash readback | Win10/Server2016 not directly tested; temporary P-256 is not production account/tx signing; Authenticode NotSigned; local/public/hosted/production/store false |
| Go SDK | Run 31772532074: deterministic 0.1.0 formal archive, clean extract/install, module+consumer tests, Auth vector, exact `0x1917`, temporary device proof and download reverify | not publicly published/hosted; production account/tx signing, production signature and store false |
| Linux/Windows CLI | Native package lifecycle, exact Testnet read and ephemeral P-256 device proof | Asset signing/transaction, public hosting, production signature |
| TypeScript SDK | Reproducible local tarball, clean-consumer install/import and exact Testnet read | npm publication, automatic signing/transaction, production signature |

`sign` is intentionally narrower than package signing. A disposable Android certificate, unsigned executable, ad-hoc macOS bundle or simulator linker signature never satisfies either the Wallet signing gate or `productionSigned`.

## Verification

Run the local immutable-object gate:

```sh
node scripts/verify/wallet-auth-release-evidence-matrix.mjs
```

Add bounded remote branch and exact Actions-run checks when GitHub is reachable:

```sh
node scripts/verify/wallet-auth-release-evidence-matrix.mjs --remote
```

The verifier rejects a `true` gate unless a direct evidence record explicitly supports that exact platform/gate pair. It also rejects production/store promotion for temporary, unpacked, simulator, disposable, unsigned, ad-hoc or local-only artifact classes.

The 2026-08-14 resumed snapshot was upgraded through GitHub Git-database readback. Every consumed checkpoint has an exact remote commit, parent, tree and evidence blob; Owner branches were fetched without touching the working tree. These source advances promoted no public, hosted, production, store, callback, reconnect, signing or transaction gate without direct evidence.

The frozen checkpoints are Core `404f818719b920008f88f076949a4387c5130855`, Web `46d030c85c2b1a3d12a10c6b5dd0e521ca303f1c`, Android `66d321e423baedb0e030650729f1000d25a351cf`, iOS/macOS `3b27b83f18799ff74252469075ec460b6665dd44`, and Desktop/CLI/SDK `2802876f8470264c4a8819f1426e28f957a09289`.

iOS run 31793565880/job 94745600713 passed all steps at source `dd479d28…`: cold PID 30160, Keychain add/read/delete 0/0/0, second PID 30616, malformed callback PID 36979 visibly rejected, and recovery `native-unavailable` visibly failed closed before terminate/relaunch proved an empty Create state. Evidence commit is `369578f2…`. This does not prove biometric/recovery/auth success, physical-device behavior, Testnet, public hosting or production distribution.

iOS/macOS AASA contract `3b27b83f18799ff74252469075ec460b6665dd44` (parent `b5594f16…`, tree `3e9afc7917251ca8df433bd2da1bbd0b576c464b`, README blob `1a69d115…`) passes 3/3 local contract tests. Direct public readback is still HTTP 200 `text/html`, 1,018 bytes / `0206ff01…`, so the well-known path is a SPA fallback and verifier exit 1. Real Team ID, signed bundle binding, Core-frozen components, AASA validity, associated-domain freeze, Universal Link delivery and authorization success remain false.

Website main `92a8b90e4eb652fd308436c6caf3c30ee9730c62` merges `c70bf01…` through PR #34. The unchanged `deca6f4f` production verifier independently returned HTTP 200 for three pages and verified nine full downloads plus exact registry metadata. Web `46d030c…` visibly confirms three buttons and exact content-addressed targets. PWA 272,706 / `63d83c…`, Chrome/Edge 188,846 / `c73309…`, and Firefox 188,883 / `417d9b…` are officially hosted/public; they remain unsigned, non-store, and do not establish installation or Wallet/provider/account/sign/tx behavior.

Web `60614bf5…` verifies Mozilla Firefox 153.0.4 from its official CDN (154,770,807 bytes, SHA-256 `792b313c7e2d2b1327f76f455315dd9d68c59c96935aa5e8c67ae42fe6aeea97`), universal x86_64+arm64, minimum macOS 10.15, Developer ID `43AQ936H96` and notarization. The unsigned YNX Firefox add-on ran temporarily in one isolated disposable profile across first PID 53579 and second PID 53723 with a stable UUID. Popup navigation was requested, but popup DOM and background were not observed. Only `browser-extension.coldLaunch` and `secondLaunch` become true; installation and every provider/release/production claim remain false.

iOS run 31786857637/job 94724590965 ended failure only at recovery step18. Direct successful scope: cold PID 28338, second PID 29129, callback PID 35715, Keychain add/read/delete OSStatus 0/0/0, malformed callback received and visibly rejected, and Universal Link policy fail-close. Artifact 9214296692 is 98,461,111 bytes with digest `fd7fa00f37461132c1b9d8799b773bd62ff32603a88a9c03d910ec502acb5afd`. Recovery and biometric success, authorization success, official hosting and every production distribution claim remain false.

iOS run 31785220186/job 94719518072 passed entitlement extraction and signing verification, then `simctl install` succeeded but SpringBoard rejected the first launch at 09:01:13Z. No process ID, Keychain probe, second launch or callback exists; steps 16–18 were skipped. The embedded entitlement plist is identical across arm64/x86_64 with SHA-256 `40af00c37606ac1a411d773cfe7640e464ff0a84f8ff6f5dc8661006b07430cd`. Follow-up run 31786857637 has not reached terminal evidence, so all new launch/auth/recovery/public claims remain false.

The isolated publication-kit verification reproduced PWA 272,706 bytes / `63d83cd20925f2d52c0f21f548fa7a857a4d056e03e5fa16244f173164a7d287`, Chrome/Edge 188,846 bytes / `c733093dea47c6612c8a9d5ecea40be2227f62402f4b4966955c9e1accf4e2aa`, and Firefox 188,883 bytes / `417d9b9e5babf05fdfdf8161504389eb99c636be75f94444bf4ff91a9b4536b3`. Its self-test passes, while the live `--expect-unpublished` monitor records 0/9 artifact passes and registry mismatch. Web hosting/deployment remains false until the production command exits zero.

macOS arm64 CLI run 31776448279 proves native-CI install/upgrade, cold/second start, frozen Auth vector, ephemeral device proof without key persistence, exact `0x1917`, fail-close, uninstall and connector rehash. The official URL is `https://www.ynxweb4.com/downloads/wallet/sha256-21db36f1c80d4e88520918de141a7f71921817799270ff671db88179023b5591/ynx-wallet-cli-darwin-arm64.gz`; independent re-download returned HTTP 200 `application/gzip`, 4,904,463 bytes and SHA-256 `21db36f1c80d4e88520918de141a7f71921817799270ff671db88179023b5591`. The three YNX aliases and public registry/page bundle bind the artifact. `downloadHosted` and current `deployedPublic` are true only for this candidate; ad-hoc signing, failed rollback attempt, no account/tx and no store keep all production claims false.

Linux x64 RPM run 31776185699 proves Fedora 42 x64 DNF/RPM scripts, install→upgrade→rollback→re-upgrade, sandbox state, GUI cold/second launch, exact `0x1917`, RPC fail-close, uninstall and artifact rehash. The RPM is 86,926,281 bytes with SHA-256 `8cf24d83dd5da5851484eab14ce9e6cd16946c95699a7af1e11048bbd7692bea`; it is unsigned and unhosted.

Core source `d5bb0a036827878b291b2c26b1f7e09ca31a93b1` and evidence `b8467853060db04c2981abb7fcfa22d4cfdcf65b` prove local Smart Account batch semantics: owner/WebAuthn success, Session Key AA24 rejection without nonce/target mutation, and failed-subcall rollback. Wallet/Auth 184/184 passed. This is Hardhat EDR in-process only and promotes no external Bundler or deployment gate.

External Chain Core contract version `1.27.0` is identity-bound at implementation `a456daeca2f89af65ac39840efb40ada1cba2e29` and contract commit `f55934b7d5a24abf0e6de471441cceacc47ad5e7`. Direct Owner object readback verified parent `a456daec…`, tree `978ac223…`, contract blob `e6595dc5…`, content SHA-256 `9aa77ff5…`, package `e19b236f…`, readiness `e3ae947b…`, and the 111,258,870-byte bundle SHA-256 `39120dab…03cd6`. v27's durable validator-safety evidence is local and single-process bounded. This is dependency-contract acceptance only: Wallet/Auth remains Product Session authority, Chain Core remains `dependency-not-accepted` and fail-closed with parallel Auth forbidden, and no source integration or public deployment gate is promoted.

Product Session Router v2 hardened evidence `2bcdf4f646177fe2419f1af3ac9e66bb3c218194` (tree `aca1d13f087c0803d2a10f15beaa68d13cbbf163`, evidence blob `06b6b18f520b1ffea50e874668d13f3b824d32bf`) freezes deployed source `d26ed915516c97d07cb4d58e5fc4646486afc851`. Direct evidence covers isolated persistent service 6441, route precedence, protected rollback, public lifecycle, and a real chmod 0644 runtime tamper: HTTP 503 `INSECURE_STATE_FILE`, identical before/after SHA `f3d9c5e1…e6c6f`, no silent repair, sticky fail-close, explicit 0600+restart recovery and a passing post-recovery lifecycle. The accepted boundary is hardened but still interim and route-level: legacy 6437/6439 are unchanged, no product runtime is migrated, visible Wallet approval is false, and neither central absorption nor aggregate Product Session public completion is claimed.

Core/Auth `19277165ec69c3d0dba76050c2529710d43f88b7` (parent `3387fd5…`, tree `a4c4df2d9e5b7b03437e7b7c84228dfa475ab291`, evidence blob `855db0936f281566edda63a70a6a54b4df4fa994`) directly proves six production-6441 negative cases and a 294/294 package pass. Wrong product/device/bundle, scope widening, sibling device revoke and expiry all fail closed with the expected HTTP 403 codes. The evidence explicitly records that d26ed915 does not pin device+inode across requests and did not publicly execute symlink, hardlink, same-bytes inode replacement or digest-tamper vectors; those remain false with aggregate and central deployment.

Core/Auth `99523546c6486f65825d84aa884190fc5bd76128` (parent `19277165…`, tree `81581c2549241d92479023e4b2431c111e35d525`, evidence blob `f23ea4e9ab285767bfc2309375b4312da2d2ec11`) directly proves public source `37f2485…` cross-restart exact-request idempotency. The completion response is byte-identical at 1,122 bytes / `a02b0576…`, state SHA `2843220c…` is unchanged, revoke/post-revoke passes with `SESSION_REVOKED`, and the private retry record is removed. Full package is 295/295. The isolated 6441 fact does not migrate products or establish visible approval, central absorption or aggregate deployment.

Core/Auth `404f818719b920008f88f076949a4387c5130855` (parent `37f2485…`, tree `72546994c171d7708d03d6850bb6b7048ba687a1`, evidence blob `afb10801e44b4baf1d1232335ca6bb24ff35da0e`) directly proves the five-vector public state-integrity regression. Mode 0644, hardlink and symlink are rejected as `INSECURE_STATE_FILE`; same-byte inode replacement as `STATE_FILE_CHANGED`; digest tamper as `STATE_TAMPERED`; every case is HTTP 503 and zero mutation. Post-repair source/version/services/lifecycle pass, while product migration, installed approval, central absorption and aggregate deployment remain false.

Core/Auth `f1c43b77b054da2d918e2b10ec5cad8afe6e3645` (parent `99523546…`, tree `3da76178e03ed98c7c09845ababd804122402e08`, evidence blob `bb5016c4203729acf4096394313ec8f546f9f7e1`) directly records the public rejection gap. Request `req_public_reject_6yW6JexciGfT-m6X` receives HTTP 404 `ROUTE_NOT_FOUND`; expected HTTP 403 `AUTHORIZATION_REJECTED` is absent. State digest `006b2aca…` is unchanged and mutation is zero, so no public rejection capability is promoted.

Website `24c0589e729a2a1ae59400600c346e6f18dd7864` (parent `31cfb602348f626b277d6c8750593ab89ded188f`, tree `b38e808bcc858116323e42a318ba0fc9892e2006`, evidence blob `a4b257ebfcdb9e3012c232f857e0c0176edfbf1d`) records the official Product Session runtime publication. Build and two production deployments are successful/Ready; three aliases return HTTP 200 runtime JSON at 2,059 bytes / `35d50f3e…`. The JSON truthfully retains zero migrations, no installed Wallet approval, no central integration and no aggregate ecosystem deployment.

Android source `c1568cc2585426cda0a7705fec3766581323fc42` and checkpoint `8666c0bb0535270e595f3db54e7d2e35b18afe66` prove finally-zeroing for temporary decoded 32-byte Uint8Array keys across 8 signing domains after success or exception. Wallet/Auth 115/115, Wallet 104/104 and Hermes 2749 passed. The immutable JavaScript secret string returned by SecureStore is explicitly not claimed zeroed; no device or release truth is promoted.

Android evidence `66d321e423baedb0e030650729f1000d25a351cf` (tree `9be218e6fe008e4201d3a0df5127b241626052a1`, blob `e3bda4a99d6dd7a05e92e70b4da8aaca52e11fa7`) binds source `9f91b1f5…` to a disposable API 36 arm64 AVD. It directly proves fresh install, cold PIDs 2840/3641, strong-biometric wrong/registered fingerprint behavior, background relock, Social review, duplicate pending rejection and missing callback-package fail-close. The session-local APK is 30,741,119 bytes / `fba1c8e1…92365f`, signed only by disposable QA certificate `bd03ab0e…e29c24`. Terminal replay, process reconstruction, authoritative balance/nonce, callback delivery, signature/broadcast/receipt, website hosting, production signing and store release remain false.

iOS run 31774232444 ended in failure. It preserves cold PID 30853, second PID 30975, and a malformed callback delivered through the system Open sheet to PID 39845 then rejected by the app UI. Step 15 did not execute `openurl`; recovery failed. Commit `50d3b2e2c5bd77456b84f348c48fa4a9ed76b5b3` freezes only the recovery-precondition workflow source and does not turn the failed run into a CI pass. Deep-link delivery, recovery/biometric, auth success, Universal Link and public/signing gates remain false.

Android branch head `19d86a333cecc9f241af5a19e7f7cccd560dbe3c` is observed but unreviewed and remains queued. Unknown descendants are not consumed. Public/hosted/production/store truth is unchanged.

The public audit is machine-readable at `release/integration/wallet-auth-public-evidence-audit.json` and fail-closed verified by `scripts/verify/wallet-auth-public-evidence-audit-check.mjs`. It records public RPC/health/website observations separately from current-source deployment, exact downloads, signing level and ComputerControl evidence.

Public service discovery and mobile Wallet routing are separately frozen at `release/integration/wallet-auth-public-endpoint-service-discovery-matrix.json`. External mobile Chrome cannot acquire EIP-1193 merely by returning from YNX Wallet. The only accepted modes are an already injected provider, YNX Wallet canonical authorization deep-link plus exact callback/Product Session, or a MetaMask mobile DApp link whose built-in browser exposes a provider. Current Faucet, CORS, callback, Explorer and operation gaps keep all mobile success and aggregate booleans false.
