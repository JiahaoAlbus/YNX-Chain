# YNX Browser current plan

Updated: 2026-07-27  
Branch: `codex/final-browser`  
Goal: Active  
Phase: FREEZE

## Protected runtime checkpoints

1. `06fb7ee7e321743288348feefa3fb76e9f096463` — isolate macOS Private download metadata and bind source attribution to the initiating tab.
2. `91685b728cefefabec9414317f2663d659062edc` — state schema v2, v1 rollback backup, migration, corruption recovery, export/delete and backup/restore core.
3. `0515ff50b22547840c6554b29c4af3cd17484800` — Windows non-exportable CNG P-256 Wallet request builder and strict callback envelope.
4. `88bf8dddf06411ea26749abdd5ea52173b7cd10a` — release coverage and Browser-owned integration freeze candidate; pushed and remote-equal before macOS evidence work.

## Newly verified at `88bf8dd`

- Swift 6.1 arm64 release build and link pass.
- macOS ad-hoc-signed Testnet Preview package pass.
- ZIP SHA-256 `d41826d277f10a96ef3c5621a3c514689d9a450f094da36c8c87fce8c1efc506`; 103039 bytes.
- Executable SHA-256 `279cac226dab8fe06b9f394984a53a900d560008a44ce87a99894804b090eb56`.
- Packaged app cold start, graceful quit and restart pass.
- Gatekeeper rejects the preview; production signing/notarization remains false.

## Immediate sequence

1. Commit and push the macOS build/package/runtime evidence and verify local/remote equality.
2. Execute a normal/private macOS download pair or a native evidence harness that exercises the same persistence policy and proves only the normal record persists.
3. Exercise the macOS `ynxbrowser` callback path and exact rejection states.
4. Wire state-v2 export/delete/backup/restore controls into native platform UIs and run installed restore drills.
5. Run Windows CI on a Windows/.NET 8 host; compile/package/install, register `ynxbrowser`, and execute nonce/tamper/expiry/replay callback vectors.
6. Submit the four Browser tuples and vectors to 02 Wallet/Auth; keep Browser fail closed until accepted.
7. Continue privacy-safe observability, retention/service-exit policy, SLO/capacity and supply-chain evidence.

## Truth boundary

- Product-wide `testedLocal` remains false because Windows/iOS/Android final-branch and cross-product gates remain open.
- The macOS artifact is locally built, packaged and executed, but not installed, hosted, notarized, production signed or store released.
- Central integration, Testnet and public release remain false/unverified.
