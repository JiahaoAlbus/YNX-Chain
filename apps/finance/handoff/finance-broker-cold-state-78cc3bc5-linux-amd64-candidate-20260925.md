# Finance Broker cold-state Linux amd64 candidate — local only

Source/tooling commit `78cc3bc524ed71c9dc90e311fc14ded0a1d38a96`, tree `41dee5f9b62c136afdbdd811bfd5d9a6cfdb17d9`. The active reviewed Wallet verifier pins the Broker cold-state fix and is byte-identical to the v6 manifest in `apps/finance/evidence/`.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `apps/finance/evidence/release-candidates/finance-broker-cold-state-78cc3bc5-linux-amd64.tar.gz` | 30,854,891 | `8707bc1531f01eac6c476511cf193c74147cdf1857fb59cc9eceba55ed84105c` |
| Sidecar `.tar.gz.manifest.json` | 539 | `709356e86974ae78394109d32ba906a62d2cabff9b96e50d678a71fd4f016065` |
| `apps/finance/evidence/release-candidates/finance-broker-cold-state-78cc3bc5-verification.json` | 13,116 | `ac53dd940ca52514dfee35945c7abec844ff9fbbc5f5a0be3577423b7e94c338` |

Release identity `finance-weekly-v3-78cc3bc524ed-linux-amd64`. The builder made two byte-identical compressed archives from the clean exact source. The verifier independently checked every member, x86-64 ELF and seven HTTP endpoints on a local Ubuntu 24.04 Linux/amd64 cold start, then a second read-only legacy-state cold start. Source gates: Finance npm 130/130, security 350 files, sequential smoke, Go tests and vet pass. Browser tests covered 390px Chinese cold load, distinct unavailable-versus-empty Broker search, prior selection invalidation and unchanged order-review behavior.

This is **not** the public Finance runtime or an installer. Root/Release Control Plane must independently re-read the current Finance host, release link, data backend/backup, environment, unit, Caddy, service, asset hashes and rollback target, then issue a unique Finance-only deployment lease. No official Broker account, order, Wallet approval, Product Session or testnet transaction is inferred from this package.
