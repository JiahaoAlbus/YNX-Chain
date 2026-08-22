# DEX public runtime deployment lease request — post P0-179 release

**Request state:** `PENDING_CENTRAL_SINGLE_USE_LEASE`  
**Scope:** DEX only (`apps/dex/**` and the immutable DEX release archive below)  
**This document is not a deployment authorization.** The earlier P0-179 prerequisite is recorded as released by Central coordination; no prior lease, command receipt, or runtime assertion is reused.

## Immutable candidate

| Field | Exact value |
| --- | --- |
| owner checkpoint | `bce90db6522edf2d745631823dd224cc0786ba4e` |
| checkpoint tree | `e73bc0c619a39c4cdb14f22c7cc74946130a1c43` |
| runtime source | `7563dc6604540715f87d4e1e46b4ed41feaf6235` |
| runtime source tree | `a7edd2575d8f6f6d21abbd10baec26dcfbdbddbb` |
| archive | `release/dex/ynx-dex-7563dc660454-runtime.tar.gz` |
| archive bytes | `3124626` |
| archive SHA-256 | `4d80b76890191ff93feb75e3bd4214078d1ad9e269d54829f4c3781e082fd092` |
| archive inventory | `release/dex/ynx-dex-7563dc660454-runtime.inventory.json` |
| inventory bytes | `3533` |
| inventory SHA-256 | `b7e55c11e64638993d2980db5be781693f11a2b14a73b43752b5da9fea3405a0` |
| Linux amd64 indexer SHA-256 | `b3a558af9bf2a8491a6e54b843687db461decfc9ff49748bdcf845d6f5141605` |
| Linux amd64 indexer bytes | `6942868` |
| release script | `scripts/dex-public-runtime-release.sh` |
| release script SHA-256 | `2d5716c6cd241c0df63c26d134507e7efae93e59ef57a08c0bf1c1d9e825be48` |
| release script bytes | `7936` |

## Single-use lease inputs Central must bind freshly

Before issuing a lease, Central must read the actual DEX host and include the exact values in a signed lease:

1. target host, architecture, service name, `ExecStart`, `WorkingDirectory`, unit path/hash, env path/hash, Caddy route path/hash, state path/hash-or-absence receipt, active symlink and its realpath;
2. current release binary and served Web asset inventory (path, bytes, SHA-256); current `/`, `/version`, and `/health` URL, status, bytes, body SHA-256, and source identity if exposed;
3. immutable candidate stage directory `.../ynx-dex-7563dc660454-runtime-sha256-4d80b76890191ff93feb75e3bd4214078d1ad9e269d54829f4c3781e082fd092`, a same-filesystem backup path, and a collision-free release directory;
4. exact command bytes and SHA-256 for the release script invocation, every preflight, backup, switch, restart, health check, public verifier, and rollback command; and
5. rollback receipts binding the old symlink, old binary/assets, env, unit, Caddy, state, service activity/restart count, and public response hashes both before the switch and after a rollback.

The lease must fail closed if any freshly read value differs from the signed value or if any candidate file differs from the immutable inventory. It must contain one DEX-only path lock and an explicit expiry. It must not authorize Exchange, Finance, Pay, Quant, Wallet/Auth, or any wallet approval/signature/transaction.

## Execution and verification boundary

The only permitted executor is the signed future lease. `scripts/dex-public-runtime-release.sh` already implements staged checksum validation, a rollback-first backup, and receipt output; it must be invoked only with lease-supplied dynamic values. A deployment success would still require separately captured source-bound public and direct wallet E2E evidence under Router gate `875be208e8a7ddb60345d55b93fc299949664e5c`.

Until that evidence exists, these all remain false: `deployedPublic`, `sourceBoundPublicRuntime`, `installed`, `providerApproved`, `walletCallback`, `swap`, `liquidity`, `transaction`, `ProductSession`, `ComputerControl`, `productsConnected`, and `migratedV2`.
