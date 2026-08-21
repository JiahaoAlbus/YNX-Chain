# P0-141 Finance deployment — fail-closed before write

P0-141 was consumed at its first rollback-first production preflight failure. The current symlink correctly resolves to `/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a`, but the lease runbook's required binary path `$current/bin/ynx-finance` is absent. The exact current binary digest was supplied by the lease, but its actual path was not.

No alternate location was guessed. No candidate archive was uploaded or extracted; no release directory, symlink, service, environment, systemd, Caddy, Wallet, or account state was changed.

Fail-closed recovery readback confirms the old public runtime remains healthy:

- Service: `active`, `NRestarts=0`
- `/version`: HTTP 200, 130 bytes, SHA-256 `39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226`
- `/health`: HTTP 200, 485 bytes, SHA-256 `d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1`

The immutable details are in [failure evidence](evidence/p0-141-finance-production-deployment-failure-20260821.json). Integration must now mark P0-141 `NONREUSABLE/RELEASED`; only a new lease that independently binds the actual old binary path can authorize another attempt.
