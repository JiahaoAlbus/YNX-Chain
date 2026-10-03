# Official Native Matrix consumer, implementation candidate

This is owned product source, not installed acceptance or a release. No legacy
custom envelope, Social key, history, store, account or Web MXID is migrated.

## Exact upstream inputs

- Android wrapper `3b187eecc2b30f0dfad594be0ce13acf4e885a9c`, Rust
  `2a3db80e99fe322b9849325a182dc8a634fb20d4`, Maven SDK `26.09.28`.
- Apple wrapper `d66ebb38271b75b1f101ccbc927c340aff09c71b`, Rust
  `48e07662de89d626c1ee0349ee44c5553ca30eb7`, Swift release `26.09.07`.
- Android resolved AAR must match SHA256
  `5aa337869a5df71d05e907902d93b4953ed986495c61728728a251077c61f793`.
- Apple downloaded xcframework must match SHA256
  `ad34daa3dd57e1cdf3c241a496a9b6f257ac28e38ff977e5c7b0a18d496ef74a`.
- Source capability report delivered by Root: SHA256
  `7b6722d05079a47e2de46b8e3e2653b68518192cfee750a08498559eda88f7fa`.

Official source declarations, not parity assumptions, drive this bridge. Neither
platform uses `Room.sendRaw` as a common receipt. Only actual queue `SentEvent`
contains SDK transaction/event correlation; authenticated SDK event readback and
the original Social business index must still settle delivery. Attachment join
after cancel is not delivery. Unknown native journal entries are not removed or
re-enqueued using a replacement transaction. No automatic SAS approval.

The SDK uses `data/matrix-sdk-crypto.sqlite3`, `kv.account`, with an encrypted
account pickle. These were inspected in each exact upstream crypto store source
and its `001_init.sql`; the latter SHA256 is
`f30a5170a73691bef37e18a32288f62e7365f00e847fc1344888e260c00d8836`.
The bridge first opens read-only and requires an existing account row. Original
passphrase and store compatibility are then exercised by the actual SDK. A bearer
without that store cannot enroll the old device. New device enrollment must use
the official native auth client in the same namespace, with A's verified mapping.

## Actual consumer and A-owned integration

`installedMatrixConsumer(current, acceptedPeer)` loads `YNXSocialMatrix` through
Expo's real native module registry. Expo Go cannot provide this Rust native SDK.
The public JS binding has account/HS/MXID/device/authority/expiry only. Tokens and
DB passphrases are never JS arguments or events. Native `MatrixVault` is the
native-only entry for A's already verified original SDK session. Session delegates
store tokens in AndroidKeyStore-sealed AtomicFile / iOS device-only Keychain.

A must supply actual HS/OP/RP, OAuth client/return registration, original MXID and
device provenance, native same-store enrollment, supported sync version and the
original canonical authority callback. A Wallet ProductSession is not a Matrix
bearer token. `NativeMatrixWorkspace` is implemented but NOT mounted into legacy
App routing until that precise consumer input is connected. Existing custom
Messages remains unchanged and must not be called the mature native path.

The new workspace refuses revoked contact and widened/unencrypted direct-room
audiences; it never auto-accepts a Social contact from a Matrix invite. Private
events clear on background/close/authority loss. Native epochs fence callbacks;
retired-handle cleanup cannot pause a newly restored identity. Old stored sends
are preserved, not automatically replaced. Current-session logout is not a
general cross-device delete/revoke API; that remains A's accurate HS/Auth gate.

## Required checks, not claimed results

1. Product typecheck and focused synthetic consumer negative tests.
2. Expo autolinking discovery and plugin fixture checks, Ruby podspec syntax,
   Swift parse. Parsing does not typecheck SDK calls or prove native linkage.
3. Android compile against exact resolved AAR/ABI and real Expo module; Apple
   compile against exact wrapper+xcframework with full Xcode. Both binary SHA
   checks must run on actual downloaded bytes, not release metadata.
4. Real Android/iOS native enrollment, same-device restart, encrypted file/text
   readback, original SDK transaction recovery, peer revoke/cancel fences, human
   SAS, current logout and protected cross-device revocation.
5. Original C01-C07/V01-V17, ABC ordinary journey three times, public source
   binding, original identity across nodes and final release/installation gates.

Current source gaps remain: main App mounting and original native enrollment,
full recovery UI/settlement of native journal against SDK+Social index, received
media viewing and verified attachment descriptor/content readback, native build
and real lifecycle acceptance. This batch does not declare these complete.

Final integration/build/release/Host are A-owned. Local compiler QA is not a
deployment or final product artifact. Packaging must retain official Apache-2.0
licenses and the actual binary transitive notices.

## 2026-10-03 compiler and isolated installed UI checkpoint

The Kotlin module now passes actual compileDebugKotlin against the pinned Expo
and Matrix SDK. Official Android AAR SHA validation is a separate non-transitive
configuration and a native compile prerequisite; no SDK verification was disabled.
The Expo Coroutine extension import and sealed RoomVisibility.Private are fixed
from locked declarations. React 19's optional original-intent ref explicitly starts
as undefined, with existing guarded access retained. Typecheck and 193 source tests
pass. Actual product Android/iOS JS exports pass, not Apple native compilation.

The evidence/native-matrix-compiler-ui-20261003 carrier preserves failed builds,
passed module/APK builds, and real Android emulator UI captures. The debug APK
embeds a temporary QA App, not the product App: it uses the real component and
native module with an authority callback that rejects before credentials/network.
Actual restore rejection, close, and reopen were exercised with no crash buffer
entries. Normal authorized Matrix operations, final product mounting, HS enrollment,
formal installation/public E2E, and dot MONSTER acceptance remain NOT_VERIFIED.
The Web build currently fails closed on SOCIAL_REGISTERED_SCOPE_CARRIER_MISMATCH;
only the integration owner may supply the exact approved Social registry carrier.

## Original intent recovery and verification fencing successor

The native sealed journal now exposes only its original non-sensitive intent DTOs,
never staged file paths, keys, tokens or passphrases. Android AtomicFile backup
recovery is retained. SDK sendWithExtraContent and upload extraContentJson carry
the original nonce inside SDK-managed encrypted content. Only an own remote SDK
event with matching original nonce, room, kind and text can mark it observed.
Queue callbacks without content no longer guess the current intent by timing.

Observation deliberately does not settle, remove or resend an original journal
entry. The consumer and recovery UI refuse replacement nonces while originals
remain pending. Fresh authenticated server readback and original Social index
settlement are still required and are not implemented by a cached SDK read.

Verification callbacks are bound to generation, accepted peer and attempt; SAS
approval requires the latest SDK revision and explicit human comparison. Expired
authority clears visible state while retaining the sealed original journal. Late
restore failures cannot invalidate a newer session. Synthetic source tests cover
these boundaries; they are not real encrypted delivery or device trust evidence.

This successor passes typecheck, 203 source tests, actual pinned Android module
compilation, debug APK assembly and Android/iOS JS export. Swift parsing passes,
but Apple SDK typechecking/linking still requires full Xcode. Actual isolated
Android UI exercises unavailable canonical authority, close and reopen only.
Product native mounting, authorized enrollment/lifecycle and dot remain open.
