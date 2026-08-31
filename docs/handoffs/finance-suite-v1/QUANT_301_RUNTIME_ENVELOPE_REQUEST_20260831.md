# Quant 301 runtime envelope request — 2026-08-31

## Exact local candidate

The current Quant owner source checkpoint is `301b680ac8bec297108a75920b1c34354345b574` (tree `9bf449bb52d8d2d1a3c6222da4f4891f7f22e9e0`). It contains the stale-provider listener detachment fix, so an earlier `9b1ff8b264a50210d44d600916bf02d42f570871` runtime candidate is not a valid deployment source for this checkpoint.

The existing deterministic packer was run locally with `GOOS=linux GOARCH=amd64 CGO_ENABLED=0`. It did not write the Quant worktree.

| Item | Value |
| --- | --- |
| Runtime archive | `/tmp/ynx-quant-301b680ac8be-runtime-source-candidate.tar.gz` |
| Archive bytes / SHA-256 | 3,337,769 / `b19d2e3111cc4c106eb5fe33a5b5ee222668a8bd91d9eb91a36e668aa23abc42` |
| Archive metadata JSON bytes / SHA-256 | 2,933 / `966f4b2f03b397b1a6c79b5f40d13920addad90095cf3833e42cc156982bcfe8` |
| Linux amd64 `ynx-quantd` | 7,905,464 bytes / `d18fa8b07efb64f99468b3d27d98eda4ccd7bc662f2e6d8227670070cdee44dc` |
| `web/wallet-auth.js` | 75,687 bytes / `ebba4bb70e270327159d7d8db3bcc50e0ebc05456025edb318054cab69c4041b` |
| Bundle manifest | 2,570 bytes / `9a1cce5acbeb2dd7c057f6a9a2ecc2487aafdc71181ffe09231953f7f64ad9e6` |
| SHA256SUMS | 1,074 bytes / `c073a76ae4bcf820242d418e85666927d1c62624f63d37f66566755005dd3c79` |

The archive has eleven enumerated entries: the Linux server, seven web assets, the product-session registry, bundle manifest, and checksums. Its `wallet-provider-lifecycle.js` is 734 bytes with SHA-256 `e667cbd139609067f36497f826935f1432acc6b95d6da3b1dc6d1ce2a5d6e91f`.

Focused source gates are recorded in `FINANCIAL_SOURCE_GATE_READBACK_20260831.md`: 9/9 Quant unit tests, 4/4 local browser checks, canonical-authorize verification, and a wallet bundle build passed. These local gates and the archive do **not** establish a public deployment, installed runtime, provider approval/rejection, callback, Product Session lifecycle, strategy execution, paper order, Testnet order, signing, or transaction.

## Required Central mapping before any deployment lease

The observed public Quant API was previously bound to `443286487e057d78cb6b1a686d14bb37be8b3c23`, not `301b680a`. Central must freeze a new, read-only deployment envelope for this candidate before issuing a Quant-only lease:

1. exact host, service unit, runtime user/group, working directory/current symlink, Caddy route, listening port, environment identity, database backend and namespace policy;
2. exact old release/binary/web asset/environment/unit/Caddy/state hashes, service PID/restart state, and rollback commands;
3. non-fallback loopback and public `/health`, `/ready`, and `/version` URL contracts, including status, bytes, SHA-256, MIME and source identity;
4. immutable stage, backup, release, and control paths, each protected by absence, ownership, tuple and substitution fences;
5. an isolated PostgreSQL database/user and the tracked `apps/quant-lab/migrations/0001_quant_state_postgres.sql` migration. The deployment must prove the mandatory namespace policy, two-instance CAS conflict/retry, restart recovery and tenant isolation before enabling multi-user strategy state;
6. a separate, single-use Quant-only rollback-first deployment lease, then a separately authorized direct public/installed Wallet lifecycle test.

The `filesystem` state backend is explicitly not sufficient to claim multi-instance production readiness: its `/ready` contract must remain fail-closed until the protected PostgreSQL backend is live. Quant remains the strategy engine; it may not withdraw, change a Strategy Vault owner, or widen a Strategy Mandate. A persisted Strategy Vault owner must equal its mandate owner, and a closed vault must hold zero YNXT.

No Finance, Exchange, DEX, Pay, Wallet/Auth, Website/global registry, account approval, signing, strategy enabling, Testnet order, or production action is included in this request.
