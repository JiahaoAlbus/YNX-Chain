# Exchange schema10 release and real-browser cache correction

This continues the source-only `EXCHANGE_SCHEMA10_WALLET_ADAPTER_20260912.md` checkpoint; it does not rewrite its historical false gates. Only `apps/exchange/**` source and the canonical Exchange service's own drop-in were changed. No account permission, private callback approval, signing or transaction was requested.

## Direct public release

Source `d736a87831fe83249ce7adfeae7a21efbc283b3e`, tree `2e26db6a13597fde7e35642e1c9515a06d761b1c`, was actually deployed to `https://exchange.ynxweb4.com/`. Before deployment, its exact Linux amd64 binary ran three times as actual `ynx` UID995/GID986 against an isolated COPY of the existing schema10 state. The copied state remained byte-identical and the isolated copy/lock directory was removed after stopping its process. Production state was not modified by this test.

The canonical service alone was stopped once and started once, with bounded exact-source readiness polling. Successful runtime PID1696915/NRestarts0; one deployment, zero automatic rollbacks. Existing state retained its exact inode1327738, 249623 bytes, SHA256 `86d52d7c764030bebc1ae0a06ebbdc030f5a6a33bb4e91177beb9cd8fd364e5e`. Public and loopback version, health, HTML and all three scripts/styles assets passed exact source/bytes/SHA checks. `ynx-quant-exchange.service`, original unit/env/Caddy bytes, existing two drop-ins and shared `/opt/ynx/exchange` and `/usr/local/bin/ynx-exchanged` symlinks were unchanged.

- Active release at the last complete direct baseline: `/opt/ynx/exchange-releases/exchange-schema10-d736a87831fe-20260912T113000Z`.
- Own drop-in: `/etc/systemd/system/ynx-exchange.service.d/zz-exchange-schema10-d736a87831fe-20260912T113000Z.conf`, 212B, SHA256 `831ec6a3971561c93698e3ac84835dd24ffe30ed945c1cd8939d9eff2f762874`, dev64770/inode1604469/root:root/0644/nlink1.
- Version: 200, 107B, SHA256 `3c0bbc64dc5c2b46bf022341e332595c0a4a95cf12a2befa73ac2820d249a0d0`.
- Health: 200, 307B, SHA256 `f7b2947c118b79fb9c2d6f6609a73e8d8bc6c9eca2b47d37ac6789af3c89557b`.
- HTML: 200, 20878B, SHA256 `6b0dc758aa3ff2b9414d2c22e398c86d507d0cb5f1e6318a4735d6c0456503bb`.

Exact persisted release/preflight receipts, per-file inventories, config identities and HTTP rows are under `evidence/schema10-{linux-preflight,public-deployment}-d736a878-20260912.json`. These are non-secret metadata only. Raw terminal hashes and durable local paths are in `evidence/schema10-release-and-cache-hotfix-envelope-20260912.json`.

## Real public Chrome found a warm-cache failure

Personally opened the real canonical page in Chrome and opened only its generic chooser. No YNX/MetaMask connect button was clicked. Although direct HTTP served the correct new assets, the warm browser actually loaded old unversioned `app.js` (28242B/SHA256 `883c4a8dbf7cf011c3a8d242e6067878faf7a619053c0500a261bce6e3c96964`) and `wallet-auth.js` (74683B/SHA256 `8a6a898d27d100b05fe535bf1d864bacda30150cf6d5ee1c81c16cc6910b4f99`). CDP resource bodies and last-modified timestamps prove the mismatch. It visibly replaced the intended new chooser with old labels and an obsolete APK link. This is a real failed visible gate, not completed Wallet connectivity.

Browser translation resources and a translated `zh-CN` DOM were observed; source HTML still defaults to English. No translation preference was changed and rendered-English evidence is not claimed. An `about:blank` translation subframe is not a product-created top-level tab. No product provider launch/new tab was attempted.

Screenshot: `/tmp/ynx-exchange-schema10-runtime-20260912.S33fLQ/public-warm-cache-before-hotfix.png`, 106014B, SHA256 `f4afc7b3b670c5fcf4998a4f7c1a7af7e0810820161893a4fb42f6cccc69cf94`. The browser observation and actual loaded script hashes are committed separately. Preserve the same warm Chrome tab (694445077) for ordinary reload after the hotfix; do not clear cache to conceal the defect.

## Frozen correction, not yet publicly deployed

Implementation `62f6109c163fcf98ca7a3cc58e40bd8cb91467c2`, tree `e0391a7cf30b5999b2f2057b2a5cfdf05a5e6102`: index script/style URLs bind exact content SHA256, server static responses use `no-cache, must-revalidate`, and packager asserts each query matches actual frozen bytes. No SDK, ledger or schema was rewritten.

- Archive `/tmp/ynx-exchange-schema10-runtime-20260912.S33fLQ/ynx-exchange-schema10-62f6109c163f-linux-amd64.tar.gz`: 4232069B, SHA256 `f809aa3df4b23121d15bc34a7845581b1f9aa5001208499d0e9f898db9d4d119`.
- Binary: 9568440B, SHA256 `660088fa81755cd4a3bc8af307eedcb27ee25381cf1454539a927a0afd59ad00`.
- HTML: 21094B, SHA256 `80fa2ea98c52861309696bd1fb0e42291dbddea0f18cd8a9df66589f0219fa18`.
- Frozen ops checkpoint `6a56138adfc599bd056af1b599e16d5301ab5ce5`; `scripts/release-schema10-cache-hotfix-62f6109c.py` SHA256 `b4ca4cd3833c177d0cd896fce074a41e9fd18fcd43ee4ae6e099f272090a07fa`.
- Transport diagnostic checkpoint `d215a3630f2b0dd7ae7b270b7741fda834db4152`, tree `d4b434341cfbabb62f5ed918aeeb188a2cb079fc`: one invocation only, explicit status/signal/errorCode, stdout/stderr bytes/SHA, and required nonempty valid receipt. It is not deployment authority.

Initial upload failed with empty stdout/stderr; that wrapper did not retain underlying spawn error, so its exact cause is unknown. A subsequent completed read-only inspection proved archive/release absent and d736 PID1696915 active. The coordinator then paused SSH due host KEX problems, later explicitly allowed one recovered attempt using its existing master. Before that recovered attempt, full baseline/config/state/HTTP checks and archive/release/drop-in absence passed again.

The recovered upload hit its 120-second bound: process exit255/errorCode `ETIMEDOUT`, empty stdout/stderr, no valid receipt. Preflight and deploy were NOT invoked. Archive state after this last attempt remains UNKNOWN until fresh read-only inspection. No retry or parallel upload was started. The coordinator now requires large transfers to use an independent transport, never its short-command shared master. Do not infer archive absence or success from the source's read/hash-before-create structure.

## Tests and next executable step

53/53 unit tests PASS; 8/8 actual local Chrome tests PASS (fixture accounts are not real approval); 3/3 actual Python release-function/inventory/boundary fixtures PASS; Go race/vet on Exchange/product-session/server PASS; final release scanner PASS for 133 runtime files and 11 documents including these receipts (123 before evidence additions); JS/Python syntax and diff checks PASS. Neither the hotfix Linux preflight nor public hotfix verification has executed yet.

Single operational blocker: coordinator-serialized fresh archive/current readback, then an independent large-file transport for the unchanged frozen artifact. Reconcile any existing exact/partial carrier by explicit identity before further action. Do not reuse the uncertain attempt, overwrite a carrier, use shared-master bulk transfer, or restart twice. Fresh config/state/service drift must be reviewed rather than hard-overwritten. After exact archive placement, the frozen Python `preflight` runs first, then `deploy` only on its source-bound success. Return every command's explicit receipt. Reload the SAME warm public Chrome tab normally and verify hash-qualified resources/chooser; no cache clearing or account permission request.

## Rollback and remaining product truth

The hotfix candidate's automatic rollback is frozen in its ops object: stop only `ynx-exchange.service`, remove only its own identity-bound hotfix drop-in, daemon-reload, start the verified d736 runtime, poll exact old version/health/HTML, preserve newest schema10 state. Never copy the pre-switch state snapshot over later orders. d736 and all original rollback binaries/config remain retained. Manual rollback is a separate action after fresh identity checks, not authorized by an old failed upload.

The tar.gz packages are Linux service carriers, not user installers or download publication. Installed macOS/Windows/Android, real YNX/MetaMask approval/reject/refresh-disconnect, Product Session callback, native signing, transactions and aggregate product completion remain false. Private read proof is not native trading permission. Existing advanced guest market/Spot/Perpetual/Assets/Proof/Activity surfaces remain; old private writes are clearly blocked pending the accepted native signing integration.
