# Finance rollback-first production deployment lease request — successor to P0-220

**State:** `PENDING_CENTRAL_SINGLE_USE_LEASE`; **scope:** Finance only (`apps/finance/**` and one Finance runtime release). This is a request, not deployment authority.

## Fixed source and isolated-preflight provenance

- reviewed command checkpoint: `7555f2c865166c90139107cc3ba5cee3bf2cdeaa` / tree `fe14a15a8c62972fa1deff328fd50d2dea74646f`; this successor request is deliberately a separate, non-self-referential handoff commit;
- runtime source: `7824af677dd052d20321431381523ab302614d98`;
- Linux amd64 archive: SHA-256 `d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d`, 3,937,491 bytes;
- `ynx-finance` Linux amd64 binary: SHA-256 `cccdae8ae5b5f694ca7db68540da30582564ff741978e616f7435d448a20fe3e`, 8,573,112 bytes;
- P0-220 Central release: `8c0172f6fb1c0d1220aa74298601b43e73d4e6a8` / tree `e6f59443039e43fc6a0252cb6941208497325649`, status `CONSUMED_RELEASED_SUCCESS_FINANCE_ISOLATED_LINUX_AMD64_PREFLIGHT_ONLY`.

The signed lease must carry the retained P0-220 receipt directory `/opt/ynx/preflight/finance/runs/P0-WALLET-CONNECTIVITY-2026-08-finance-isolated-linux-preflight-20260822T211600Z/receipts`, manifest `/opt/ynx/preflight/finance/runs/P0-WALLET-CONNECTIVITY-2026-08-finance-isolated-linux-preflight-20260822T211600Z/receipts/SHA256SUMS` (1,062 bytes, SHA-256 `a4581e24da7d9208d4d5b1f067134ed52fbdfd5cbfb0f143d5e1311d489ded63`) and `result.txt` in that exact directory (144 bytes, SHA-256 `b8c5cf7d9e4174f6f46f128fa6cf4844ac159c7d74177b6fdf51467f35b7fad5`). Central must read back those exact paths and bytes before authorizing execution.

## Mandatory dynamic bindings before any write

In the lease transaction, Central must freshly read and sign target host/architecture; active release and realpath; root executable path/bytes/SHA/ELF metadata; full env bytes/SHA and `YNX_FINANCE_WEB_DIR`; unit/ExecStart/WorkingDirectory bytes/SHA; Caddy route bytes/SHA; state path presence and tuple/hash; service active state/NRestarts; served Web inventory; and public plus loopback `/health` and `/version` statuses, bytes, bodies and SHA-256.

The exact freshly-read active release, environment bytes, state receipt, unit, Caddy and public response hashes are the only rollback target. Historical values, P0-141/P0-174, and P0-220's isolated paths cannot substitute.

## Single-use rollback-first execution contract

The corrected executor is `apps/finance/scripts/finance-production-rollback-first.sh`, 8,511 bytes, SHA-256 `f540da19b1d91c9184df9eb5aa8e45906823ff9673f344692261ade5674858da`; static contract regression is `apps/finance/scripts/test-finance-production-command-object.mjs`, 889 bytes, SHA-256 `480debf9bf22fd9648b3ccd271689b46519d750a3dd44ad52d24498d2c1a0054`; actual-shell fixture `apps/finance/scripts/test-finance-production-fixture.mjs` is 9,574 bytes, SHA-256 `6e02bd3fc7f39afe33b50198b163dd96358156aa1df5948a4762928a5bbc201d`. Receipt objects remain `{url,status,bytes,sha256}`. The fixture copies and runs the actual executor within a temporary root while stubbing curl/systemctl/file/readlink/stat/realpath/cp/mv; it verifies a successful candidate switch, an HTTP verifier failure with rollback, traversal rejection, and restored symlink/env/state/unit/Caddy/service state. Candidate PID must be numeric and differ from signed old PID; a manual systemctl restart must preserve the signed NRestarts value. Archive, new environment, stage, backup, and release now each require a signed immediate-child parent/basename/tuple contract. State restoration captures candidate regular-file tuple and digest after stopping, then uses same-parent atomic replacement and validates a restored tuple that intentionally excludes the historical inode.

The future lease must bind absent/no-symlink tuples for immutable stage, backup and candidate-release paths; archive upload bytes/SHA/ELF validation; extracted binary and asset inventory validation; atomic release materialization; same-directory verified env backup/replacement; atomic symlink switch; one service restart; then exact source-bound loopback/public `/health`, `/version` and asset verification.

On the first failed prewrite, switch, restart or verifier check, execution stops permanently: restore exact old env bytes, state, active symlink and service, then verify the signed old loopback/public response hashes. The lease is nonreusable after either success or failure. It authorizes no DEX, Exchange, Quant, Wallet/Auth, account request, signature, transaction, or Product Session claim.
