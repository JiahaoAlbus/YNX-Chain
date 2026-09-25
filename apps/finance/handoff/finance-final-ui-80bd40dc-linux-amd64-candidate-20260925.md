# Finance final UI Linux amd64 candidate — not publicly deployed

Source/tooling commit `80bd40dc78faf6ffc29d435b9704c915632183fc`, tree `a477ad7df4de140681d38eb589503e75f7d31387`, branch `codex/finance-evm-read-session-pr193-20260924`. The active Wallet verifier pin and 28-file manifest are bound at this source. The archive was built twice byte-identically from that clean commit.

| Local artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `apps/finance/evidence/release-candidates/finance-final-ui-80bd40dc-linux-amd64.tar.gz` | 30,854,860 | `188f3de78eb9c7f73f9700367c92ff9b2f2bb2c4cd8e7f8fa29a9f14b3d8b196` |
| `apps/finance/evidence/release-candidates/finance-final-ui-80bd40dc-linux-amd64.tar.gz.manifest.json` | 530 | `d081cc44fc6174eff993a6b43a22e4cc48d8a21f4136870c63874c2456ab3ebe` |
| `apps/finance/evidence/release-candidates/finance-final-ui-80bd40dc-verification.json` | 13,107 | `77a1e7989cf0dabda6bf7f2f0cb26f74a9a6705a35499cfb28dc9bf64cb70145` |

Release identity `finance-weekly-v3-80bd40dc78fa-linux-amd64`. The Linux x86-64 `ynx-finance` binary is 21,024,916 bytes, SHA-256 `53af50e748d06690ec69bbeea70b6ab6a49a486ae409d238c4755eb316ce9d5d`. `web/index.html` is 28,222 bytes/SHA-256 `2640700631254380435c720a5dc84b5538c01bd9033d3e310bcd49b018d10d7e`; `web/app.js` is 63,003 bytes/SHA-256 `8f568feb4c62f91668064b81bf6dabd2bc000ea174c17728d8847abe68a3d470`; `web/wallet-auth.js` is 181,663 bytes/SHA-256 `308714f5873469d528a49ce1df993fa9e3617ecabc60c7edaca7db063316893a`.

Clean extraction verified every archive member and ELF x86-64 header. A local Ubuntu 24.04 Linux/amd64 container started from absent state; `/health`, `/version`, `/ready`, `/api/broker/status`, `/`, `/app.js` and `/wallet-auth.js` returned HTTP 200 with exact bytes/hashes recorded in the verification JSON. A second cold start with the legacy v1 state read it without changing its SHA-256. The diagnostic made no provider network or write attempt; Sandbox submission remained disabled. Source gates: Finance npm tests 127/127, security, smoke, Go tests and vet pass.

This is an immutable local release candidate, **not** a public Finance deployment, download-hosted installer, real YNX/MetaMask account approval, private Product Session, Broker order or testnet trade. Before any production mutation, Integration must independently review source-to-archive identity, fresh host/service/current-release/env/unit/Caddy/state/public baselines, target paths and rollback receipts, then issue a unique single-use Finance-only deployment lease. Do not infer that a historical release path remains the current rollback target.
