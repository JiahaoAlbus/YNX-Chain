# Exchange schema10 Wallet adapter checkpoint

## Source and preserved authority

Implementation `d736a87831fe83249ce7adfeae7a21efbc283b3e`, tree `2e26db6a13597fde7e35642e1c9515a06d761b1c`.
Branch `codex/exchange-schema10-wallet-20260912`; worktree `/Users/huangjiahao/Desktop/YNX Final Worktrees/07-exchange-schema10-20260912`.
Inherited exact clean `e7a714074b93bd6feddb98113151648ae7cb7531`, tree `8c6ec1e5db74eb67e4e7f414bf3ef997d1e1c7ab`.
This is the original schema10 product lineage, NOT the older `835a76a6` schema1 candidate. Matching, state schema, ledger, perpetual/risk, Finance read integration and Quant integration were not edited. Existing advanced Spot/Perpetual/Assets/Proof/Activity/Controls pages remain.

## Wallet consumption and authority boundaries

- Standard standalone SDK: `c97f85e9ae4d4580b99860c51738e6040ca9ca18`, 22,417 B, SHA256 `b8a900ef2a5ece693cb2808a47ed0072d97c425236deb80c39497886f1535e43`.
- Private standalone SDK: `a7dad7ec1bc7c06577978bdd5fea8dc9c7a248a9`, tree `acf17fed8866d00a3c0876ec51af020da0c9e506`, 223,235 B, SHA256 `16b0d677ec21e84b5ce425138f175c37e1ac6d319db7fe5a85926b276dccd336`. Factory and Gateway adapter import the same module instance. Its original bundled license notices remain intact.
- Registry: 7,590 B, SHA256 `e74e1668e631dd623a4364cc9580951a9fe96fcef0c66c5910d84c774f4fdc08`; fixed product/origin/callback and only `exchange:read`.
- Shared connect reducer: source `98c6d5d784d212df8981a53b17118a511e246ad2`, authoritative tree `51a60a362d4ad5dd748bcdefb101f71b1d9e0cee`, original JS SHA256 `72558116f22625c6e9abf363b9dd16a7b1b80c93d88099be531cb63e70a62b92`. Unchanged source was bundled with esbuild 0.25.9, ESM/browser/es2022/minify into product vendor file, SHA256 `ffa4bd145d44995783ef2463416c8bc96bd03d366975c8236b8f8070a7493d1b`. No second protocol or reducer implementation.
- Backend unchanged shared Go v2 verifier inheritance is recorded in `EXCHANGE_SCHEMA10_COMPATIBILITY_20260912.md`.

Standard chooser selects the actual YNX or MetaMask provider, switches/adds/reswitches/verifies `0x1917`, then shared SDK requests accounts. Restore uses remembered provider kind only with silent `eth_accounts`/chain readback. Details, switch, local disconnect and acknowledged revocation are independent of private account reads. Y/M letter identity badges are original UI marks, not claimed official wallet logos. No automatic custom-scheme navigation, iframe, blank tab or browser RPC fetch is used for Standard connection.

Private panel separately calls accepted `beginExplicit`, exposes only the returned exact user-click URL (installation remains unverified), preserves SDK pending state on cold restore, forwards full callback to `handleReturn`, requires Gateway verification and fresh per-read proof. It never reads/migrates legacy raw-device keys or auto-posts an old action callback. CSP changed only to permit the fixed `https://wallet-auth.ynxweb4.com` authority. Private failure/expiry/Guest clears owned views without deleting Standard connection. bfcache pagehide does not destroy the pending controller.

Permitted private product reads are only `GET /api/v1/account`, `GET /api/v1/margin/account`, `GET /api/v1/solvency/liability-proof?asset=YNXT`, with `X-YNX-Product-Session-Proof-V2`, no credentials, no redirects, no legacy v1 fallback. Responses are MIME/stream-size/UTF8/JSON bounded, account-scoped across schema10 conditional/algorithmic/perpetual data, safe integer checked; metadata explicitly distinguishes `file-cas-single-host`/`degraded_single_host` from `postgres-cas-multi-instance`/`live`. Liability UI validates response shape, not a second cryptographic verifier. Native venue account is not EVM holdings.

Native order/cancel/perpetual/margin/deposit/withdrawal writes fail before fetch with an explicit missing signing contract message. Other private writes require an explicit separate scope; device P-256 read proof cannot authorize them. The old signed-write backend is not removed. Existing preview arithmetic remains legacy Number-based and must be separately upgraded before enabling browser writes; no signing/settlement is fabricated.

## Executed local verification

- `npm --prefix apps/exchange test`: 44/44 PASS.
- `npm --prefix apps/exchange run test:browser`: 8/8 PASS in actual local Google Chrome; desktop 1440px and mobile 390px, guest pages, exact JS bytes/MIME/CSP, missing-provider dual official fallback, stable URL/tab, legacy callback no POST, HTML fallback rejection, unsigned writes never sent, WebSocket reconnect/cursor. Standard lifecycle fixture runs at intercepted reserved HTTPS origin served only from local bytes because shared SDK correctly refuses HTTP origins. Fixture accounts/approval/events are not real Wallet evidence.
- `go test -race ./internal/exchangeproduct ./internal/productsessionv2 ./apps/exchange/server`: PASS, including inherited two-user v2/schema10 unchanged-state tests. `go vet` same packages PASS.
- Release scanner PASS (118 product files, 11 documents): unchanged private SDK upstream comment filler exclusions are exact whole-file SHA bound; secret scanning is still applied to every file. JS syntax and `git diff --check` PASS.
- Exact source-built Darwin binary cold-started 3 times with one isolated synthetic state; each `/api/version`, health and four Web bytes matched; unsigned account read 401 each time; state bytes unchanged after first creation and subsequent restarts. No production state used.
- Deterministic Linux/amd64 ELF64 x86-64 package built twice; same SHA, output overwrite rejected. Linux binary has not yet been executed on Linux.

## Frozen runtime package

`/tmp/ynx-exchange-schema10-runtime-20260912.S33fLQ/ynx-exchange-schema10-d736a87831fe-linux-amd64.tar.gz`: 4,231,210 B, SHA256 `d3e2d89c70f86793a1842dee0cde9864142f03238bfa458e0366c325ee045a40`.
Binary: 9,568,440 B, SHA256 `01b9398202aec44dc1f9872378728720a6158216f264a07e738f17a8781f3918`.
Complete inventory and local readbacks are in `evidence/schema10-runtime-package-d736a878-20260912.json` and `evidence/schema10-local-cold-start-d736a878-20260912.json`.
This tar.gz is an offline Linux service carrier, NOT a macOS/Windows/Android installer or download publication. Runtime contains the schema10 server and exactly index/styles/app/wallet-auth assets; private and Standard SDKs are inside the one bundle, with no runtime module download required.

Rebuild from the exact clean implementation checkout with `node apps/exchange/scripts/package-schema10-runtime.mjs d736a87831fe83249ce7adfeae7a21efbc283b3e ABSENT_ABSOLUTE_ARCHIVE`. Toolchain: Go 1.25.7, Node 26.7.0, esbuild 0.25.9. Fresh source-bound local version is 107 B SHA256 `3c0bbc64dc5c2b46bf022341e332595c0a4a95cf12a2befa73ac2820d249a0d0`; health 307 B SHA256 `f7b2947c118b79fb9c2d6f6609a73e8d8bc6c9eca2b47d37ac6789af3c89557b` under isolated defaults, not an expectation for differently configured production health.

## Screenshots and truthful remaining gates

Local screenshot directory `/Users/huangjiahao/Desktop/YNX Final Worktrees/07-exchange-schema10-20260912/tmp/exchange-browser-evidence/`:

| File | Bytes | SHA256 |
|---|---:|---|
| desktop.png | 203513 | 8d6584b37d92fc0b310faf3cd0a172f0deed159b6a46341421b15a0c143bceea |
| mobile.png | 65154 | 9d676565f52028c4f55d92733a910c7226cece5cde85f37920db42869052c71d |
| wallet-no-provider-desktop.png | 128689 | 955e84ea1354cc39db9a382d5b9cd9fdc44f67f8312f0ab7b382fa6d94b3e160 |
| wallet-no-provider-mobile.png | 67562 | ea9a52a79c328b706a7096589239ba574363c35399448570faa32a8ebc86cb19 |
| wallet-fixture-details.png | 150374 | de23d45dbde7b2002b1656f1a1a8bac180c97f76c73bc526c313d6a1ceb27d63 |

All public-deployed, installed, real account approval/reject, private callback/Gateway session, native signing, transaction, custody and aggregate completion flags remain false. No public request, SSH, account permission, signing or transaction was performed for this checkpoint.

Next release step is a fresh secret-safe own-service readback, original schema10 single-writer/state compatibility and rollback binding, then exact Linux candidate execution against an isolated state copy as actual `ynx` user. Do not deploy the older schema1 binary. Preserve original state and original runtime rollback; do not touch `ynx-quant-exchange`, Caddy or shared current. Service active alone is not listening/ready; use bounded exact-version readiness reads without repeated restart. No production rollback commands are frozen here because fresh current identities are not yet checked.
