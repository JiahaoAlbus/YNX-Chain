# Mounted Native scanner: original-camera callbacks and input-only routing

Parent owned source: `eb382a6792c625eec29f3b80f80b06b37a84fd78`. This changes the existing `WalletScanner` used by the current Dashboard, not a separate demo/scanner or an unmounted helper. Native `App.tsx`, startup assets, shared protocols, SDK/Auth, formal versions and release signing remain untouched and A-owned where applicable.

## Behavior

- Each camera retry/scan-again gets a new native CameraView key and synchronous callback epoch. Old barcode frames, duplicate mount errors and old retry actions cannot route or alter the next camera attempt.
- Mount failure, invalid QR, a successfully consumed result, and synchronous product-route failure stop/unmount the hardware camera. No continuous background recognition while waiting for user review or retry.
- Permission changes fence old granted-render callbacks before effect cleanup. Old permission buttons cannot launch another prompt after grant or permanent denial. A late permission failure cannot replace already-granted camera state. One permission request remains single-flight.
- Close is synchronous/idempotent; late barcode/mount/retry/permission callbacks do not mutate the closed scanner. A different reopened component retains its own refs and attempt.
- Real existing `parseWalletScan` classifies the input. Native receiving address/YNX Testnet receiving URI, existing Pay reference and WalletConnect URI remain their original contracts. No QR-provided payment amount, origin, signer policy, consent, key use, session or settlement authority is created. Raw existing invoice identifiers remain compatible references; they are not authenticated invoices.
- Parser failure stays “invalid code”; recognized input whose existing route throws gets a separate 12-language “could not open for review” message. A user can explicitly scan again. No automatic navigation/payment retry.
- Existing system font scaling, text-scale/RTL styles, 44-point controls, QR-only camera configuration and original brand remain unchanged.

## Existing normal paths and limits

Read-only current `App.tsx` evidence: Dashboard creates `WalletScanSession`, invalidates on Wallet lifecycle notifications, mounts `WalletScanner` when scanning, and routes accepted payment input to Send, invoice ID to the Pay modal, or WalletConnect input to its existing review path. This patch keeps that API and those routes. It does not change A's protected Pay integration/current authority dependencies.

Read-only Desktop evidence: normal renderer has a local receiving-image chooser and separate invoice/protected-Pay QR image controls. Its capability text truthfully states that camera is unavailable in this build; local image decoding is not a real camera test, signature, authorization or payment. No Desktop source was changed in this batch.

Actual enrolled-device permissions, real camera frames, installed Android/iOS flows, native accessibility/layout, real invoice/current authority, authenticated receipt/settlement and final website installer flows are **NOT_VERIFIED**. This does not supersede A's exclusive source composition/release authority or the previous required SendModal recovery integration. MONSTER remains **NOT_VERIFIED**, and the overall Wallet goal remains active and incomplete.

## Verification

Isolated candidate: `/tmp/ynx-wallet-android-inheritance-clean-test-20261003-1ZEdhW/apps/wallet`; current owned delta copied over prior source, dependency baseline read-only admitted SDK `9555b01e47519a5df882bb0092d2d20e1d7ce6e2`.

- Scanner/parser/session/12-language targeted tests: **25/25**, exit 0; `scanner-camera-targeted.log`.
- Full Native regression: **899/899**, exit 0, no skips (12 added cases); `scanner-camera-regression.log`.
- TypeScript typecheck: exit 0; `scanner-camera-typecheck.log`.
- Android/iOS Expo/Hermes exports: both exit 0; `scanner-camera-android-export.log`, `scanner-camera-ios-export.log`; `dist-android-scanner-camera`, `dist-ios-scanner-camera`.
- Workspace `git diff --check`: exit 0.

The handler tests execute the component's actual extracted event-handler code with controlled hook state/ref/render transitions and the production input parser, and separately assert those guarded handlers are wired into CameraView/controls. They are not real React Native rendering or OS camera evidence. Hermes exports verify bundle compatibility, not a fresh installer or final matching SDK composition by A.
