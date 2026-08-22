# DEX shared release-binding and publication lease request

**State:** `PENDING_CENTRAL_ACTION`; **scope:** DEX candidate plus the shared root `product-release.json` binding decision.

DEX checkpoint `c7a96d48f17f9dc70bbdc42389cf1052771ee904` / tree `85b8d018ee8541cc560b0865fb5f3cc0acfa2767` cannot package a current PWA because the root release binding still names `dec1ba994c7c9d48fb4708f37765cb3fe90e2e0f`. DEX must not write that shared root file.

Central must either commit an exact root binding update after validating the DEX source, or grant a narrow written authority naming that single file and expected source SHA. Only then may DEX freeze a new PWA/runtime archive and separately request a DEX-only deployment lease. The existing `7563dc660454` archive is historical and must not be deployed as the `c7a96d48` candidate.

The later DEX deployment lease must freshly bind host, executable/assets, unit/env/Caddy/state, current public `/`, `/version`, `/health`, immutable stage/backup/release locations, executor command bytes/SHA and rollback receipts. It authorizes no provider approval, signature, swap, liquidity operation or transaction.
