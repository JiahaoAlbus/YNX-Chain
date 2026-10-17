# Native scanner lifecycle continuation — 2026-10-04

Inherited baseline: `f412170d4e90065b87f4eb582a2f46683f5114e5`.
Owned scope: `apps/wallet/**`; no shared protocol, signing, registry,
release version, account storage or key changes.

## Actual source gap and repair

The parent Wallet already locks on background and checks the account-bound
`WalletScanSession` before routing. That does not synchronously retire camera
callbacks on transient OS inactivity. The scanner itself previously had only a
mount/unmount fence: inactive frames could reach its parser/route callback,
and a late permission failure could publish after the prompt's inactive/active
cycle. This is not evidence of an unauthorized signature or payment.

The shared Android/iOS scanner now checks the current OS active state at each
input boundary. Its own AppState listener retires the camera epoch immediately,
removes the hardware camera while inactive, and remounts a fresh epoch when
active. Background closes this input session once; foreground cannot revive it.
Permission requests remain single-flight. Old failure callbacks cannot replace
the resumed camera state. Unmount removes the listener and invalidates input
through the existing active-instance fence. Recognized input still routes only
to the existing review flow; there is no signing, broadcast or approval here.

## Evidence

Isolated inherited QA graph:
`/tmp/ynx-wallet-android-inheritance-clean-test-20261003-1ZEdhW/apps/wallet`.
Logs retained under `/tmp/ynx-wallet-desktop-ui-20261004-wjXlEW/`:

- `scanner-lifecycle-original.log`: 15 PASS / 4 FAIL, exit 1, on baseline
  scanner with the four new lifecycle counterexamples. SHA-256
  `8d318e0cef0b17a6f241d2c1d2226e9b54cab94536e0e4098f8ba842521bc5ac`.
- `scanner-lifecycle-final-related.log`: 116 PASS / 0 FAIL, exit 0.
  Covers actual scanner handler extraction, parser, camera permission,
  account-bound scan session, operation lifecycle, all twelve scanner locales,
  and native transfer outbox tests. SHA-256
  `095ae03d095eeff8af29c7ec927cf41a918477c4d430ea153bcd5bd82210d05e`.
- Isolated `tsc --noEmit`: exit 0. Checkout `git diff --check`: exit 0.

The first test invocation had an incorrect relative copy path and a baseline
counterexample waited on an unresolved mocked permission request. The two
owned test processes were normally terminated, the counterexample was made
bounded by resolving that mock before awaiting, and the isolated original
failure run above completed normally. No device/profile was reset.

Frozen `App.tsx` SHA-256 remains
`c9f67581648d11a3793f08a92113f8299c124eb7f978227dcbcafa213951907f`.

## Separate, still-open gates

This is source-level continuation, not physical camera/OS permission UX,
enrolled biometric, real account, QR payment, installed release, MONSTER,
crypto migration or user-acceptance proof. No GUI/device action was performed
for this batch. A supplies protected Pay runtime ports, approved crypto policy
read/write contracts and official release composition; this batch invents
none of them and does not enable unavailable integration.
