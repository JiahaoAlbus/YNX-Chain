# Operations

## Start and stop

Run individual local services using the commands in `README.md`. On shutdown,
stop accepting writes, drain or move worker inbox jobs, preserve logs/audit IDs,
back up state, terminate web/worker/specialized daemons, then core. A restart
never clears a kill switch or revoked mandate.

For Docker Compose, use an ordered restart because `ynx-quant-web` intentionally
shares the `ynx-quantd` network namespace to preserve the loopback-only Preview
write boundary:

```sh
docker compose -f apps/quant-lab/compose.yaml stop
docker compose -f apps/quant-lab/compose.yaml up -d
```

Do not use parallel `docker compose restart` as the operational runbook: the web
container may attempt to rejoin the core network namespace before the core
container is running.

## Backup and restore

```sh
YNX_QUANT_STATE_PATH=/secure/path/state.json \
  ynx-quant-cli backup --approve /secure/backup/state.json
```

Store emitted digest, bytes, schema, source version, and operator audit record.
Restore only during a write freeze after preserving current state:

```sh
YNX_QUANT_STATE_PATH=/secure/path/state.json \
  ynx-quant-cli restore --approve /secure/backup/state.json
```

Verify health/version, audit continuity, lifecycle, kill/revoke state, paper
reconciliation, and adapter idempotency before reopening writes.

Export and delete local data:

```sh
YNX_QUANT_STATE_PATH=/secure/path/state.json \
  ynx-quant-cli export --approve /secure/export/quant-state.json
YNX_QUANT_STATE_PATH=/secure/path/state.json \
  ynx-quant-cli delete-local-data --approve 'DELETE ALL LOCAL QUANT DATA'
```

Deletion is irreversible without a prior backup. The exact confirmation is
required; scripts and AI must not invoke it without a human-approved preview.

## Incidents

For stale data, provider errors, reconciliation mismatch, unexpected fills,
scope widening, replay, or audit inconsistency: activate the Quant kill switch;
revoke the Wallet mandate; stop adapter workers; preserve request/error/audit IDs;
reconcile against owning Exchange/DEX and chain receipts; notify Monitor/Status;
and do not restart execution until an authorized review closes the incident.

Quant cannot withdraw or change owners. Emergency asset exit must occur through
the user's Exchange subaccount or DEX Strategy Vault owner path. Support must not
request private keys, seeds, PEM files, full API secrets, or validator keys.

## Lock recovery

State mutations use `<state>.lock`. If a process crashes while holding it, writes
fail closed after five seconds. Confirm no Quant process is active, preserve the
state and lock metadata for incident evidence, then remove only the lock directory
and run integrity/backup checks. Never remove a lock merely to bypass contention.

## Service termination

Before discontinuation: publish notice and export window, freeze new mandates,
allow revoke/pause/exit, provide data export/delete, retain evidence per policy,
and hand users owning-product recovery instructions. No strategy may continue
unattended after Quant support ends.
