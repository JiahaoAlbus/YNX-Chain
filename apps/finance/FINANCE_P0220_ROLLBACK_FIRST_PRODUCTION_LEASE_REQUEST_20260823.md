# Finance rollback-first production deployment lease request — successor to P0-220

**State:** `PENDING_CENTRAL_SINGLE_USE_LEASE`; **scope:** Finance only (`apps/finance/**` and one Finance runtime release). This is a request, not deployment authority.

## Fixed source and isolated-preflight provenance

- owner remote source: `565b96cef09efbabfe719d44333f98f229473d7c` / tree `12bd26d328866415ebf4ebf819626e7302d0a9b3`;
- runtime source: `7824af677dd052d20321431381523ab302614d98`;
- Linux amd64 archive: SHA-256 `d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d`, 3,937,491 bytes;
- `ynx-finance` Linux amd64 binary: SHA-256 `cccdae8ae5b5f694ca7db68540da30582564ff741978e616f7435d448a20fe3e`, 8,573,112 bytes;
- P0-220 Central release: `8c0172f6fb1c0d1220aa74298601b43e73d4e6a8` / tree `e6f59443039e43fc6a0252cb6941208497325649`, status `CONSUMED_RELEASED_SUCCESS_FINANCE_ISOLATED_LINUX_AMD64_PREFLIGHT_ONLY`.

The signed lease must carry the full retained P0-220 receipt digests whose confirmed prefixes are `a4581e24` (manifest) and `b8c5cf7d` (result), together with receipt paths and readback bytes. Prefixes are not sufficient authorization values.

## Mandatory dynamic bindings before any write

In the lease transaction, Central must freshly read and sign target host/architecture; active release and realpath; root executable path/bytes/SHA/ELF metadata; full env bytes/SHA and `YNX_FINANCE_WEB_DIR`; unit/ExecStart/WorkingDirectory bytes/SHA; Caddy route bytes/SHA; state path presence and tuple/hash; service active state/NRestarts; served Web inventory; and public plus loopback `/health` and `/version` statuses, bytes, bodies and SHA-256.

The exact freshly-read active release, environment bytes, state receipt, unit, Caddy and public response hashes are the only rollback target. Historical values, P0-141/P0-174, and P0-220's isolated paths cannot substitute.

## Single-use rollback-first execution contract

The corrected executor is `apps/finance/scripts/finance-production-rollback-first.sh`, 6,847 bytes, SHA-256 `75e6aa5e6129aa24b2c8a29e4948f0a9f3c70570c84eb0febddc6c7345fce20e`; its static safety regression is `apps/finance/scripts/test-finance-production-command-object.mjs`, 798 bytes, SHA-256 `17920c10f8f7641fd0593d385b9efd21ecaaf6ec01dc2bc8d347a83e633f7e3b`. Lease schema is explicit: every verifier and asset is a `{url,status,bytes,sha256}` object; no URL/string/object dual use or dynamic verifier indirection is accepted. It also binds candidate service PID/NRestarts and exact lease-ID child basenames.

The future lease must bind absent/no-symlink tuples for immutable stage, backup and candidate-release paths; archive upload bytes/SHA/ELF validation; extracted binary and asset inventory validation; atomic release materialization; same-directory verified env backup/replacement; atomic symlink switch; one service restart; then exact source-bound loopback/public `/health`, `/version` and asset verification.

On the first failed prewrite, switch, restart or verifier check, execution stops permanently: restore exact old env bytes, state, active symlink and service, then verify the signed old loopback/public response hashes. The lease is nonreusable after either success or failure. It authorizes no DEX, Exchange, Quant, Wallet/Auth, account request, signature, transaction, or Product Session claim.
