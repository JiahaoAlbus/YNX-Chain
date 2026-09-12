# Finance private SDK cold recovery — source/local candidate only

Owner branch `codex/finance-wallet-flow-20260912`; runtime source `26a06e18b1f3bb6b0d8361204e2a2e7a64a01b0a`, tree `d3893d9f9ce054f33a2d9e07ce701eb209a2441a`. Evidence is a separate successor commit and is not self-referential.

## Exact shared dependency

- Wallet source `a7dad7ec1bc7c06577978bdd5fea8dc9c7a248a9`, tree `acf17fed8866d00a3c0876ec51af020da0c9e506`.
- `web/vendor/product-session-browser-a7dad7ec.mjs`: 223235 bytes, SHA-256 `16b0d677ec21e84b5ce425138f175c37e1ac6d319db7fe5a85926b276dccd336`.
- Registry: 7590 bytes, SHA-256 `e74e1668e631dd623a4364cc9580951a9fe96fcef0c66c5910d84c774f4fdc08`.
- Factory and Gateway adapter import from the same exact module. Standard c97 SDK/entry, Finance business app, HTML and Go backend are unchanged.
- Existing Finance scopes remain exactly `finance.ai.draft`, `finance.pay.read`, `finance.portfolio.read`, `finance.profile.write`. This slice performs no real business write and does not claim profile/AI write acceptance. No scope/authority namespace migration was attempted.

The product's old pending-only `awaiting-return` shortcut hid the fixed SDK behavior. It is removed: cold start now delegates to `client.restore()`, preserving original request/nonce/URL only after SDK binding, storage and authority-time checks. Full callback URLs still pass intact to `handleReturn`. The non-sensitive attempted marker is unchanged so the same authority namespace can restore; no old plaintext device/session record is read, exported, migrated or deleted. The Standard Wallet remains independent from private recovery/errors.

## Tests and candidate

40/40 Node tests, zero skips; Go race on shared verifier/Finance/cmd; security gate across 338 text files; syntax/diff and five retained deployment-tool guard tests passed. Five new real local Chrome/WebCrypto/IndexedDB cases cover original URL/nonce/device after cold restore, clock outage and exact Retry, expired pending retention, foreign binding fail-closed before lookup, and delayed time response after Guest. Tests intercept all HTTPS traffic in-process; real user approvals and public lifecycle are not claimed. The unchanged official 9840 offline Gateway test kernel remains a protocol fixture and independently passes new browser SDK completion/introspection/replay/restore tests.

New Web bundle: 154703 bytes, SHA-256 `8406eeae586144f0ac82f1f0192d2675ff2aa5ef0f5ffe17f2260a2564f05770`.
Linux amd64 binary: 8626360 bytes, SHA-256 `181454a5d3a8d1430355d113854aed4b8528466b0393e78a28b145095ddc5898`; repeat build byte-identical. The Linux candidate was **not executed**. Same-source local Darwin executable cold start/second launch, missing-proof401 and legacy410 tests passed against isolated loopback fixtures, not the public site.

Frozen archive `/Users/huangjiahao/Desktop/YNX Project Audit 2026-09-06/continuation-01a075bd/finance-sdk-26a06e18b1f3/ynx-finance-sdk-26a06e18b1f3-linux-amd64.tar.gz`: 3996846 bytes, SHA-256 `51f9c0ca034f6d76faf1479b652a76a8521e4854a0fc3b0399112e697a9a8be5`. Exact inventory includes binary, seven Web assets and manifest; no links or extra files. This is a server candidate, not a DMG/EXE/APK installer.

Full immutable file/test/local executable receipts: `../evidence/finance-private-cold-restore-a7dad7ec-20260912.json`.

## Public boundary and rollback

No SSH, deployment, production mutation or public browser request occurred in this slice. Previously published 7a1d release evidence is preserved unchanged; this candidate does not inherit that deployment claim. The earlier public `/version` browser denial was not bypassed. Public/installed/real provider approval/private approval/signature/transaction gates for this new candidate remain false.

No deployment rollback is needed because this slice was not deployed. Keep the prior runtime/public evidence and retained rollback material unchanged. Any later candidate publication requires a newly authorized Finance-only fresh state/config/current review; never reuse a prior deployment executor whose source/hash/path bindings name 7a1d. Do not overwrite newer state from an old backup.
