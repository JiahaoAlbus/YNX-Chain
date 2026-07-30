# YUSD Testnet Sandbox

`ynx-yusd-sandboxd` is an isolated, loopback-default accounting sandbox for testing a fully reserved settlement lifecycle. YUSD sandbox units have no real-world value. No bank account, custodian, external reserve, attestation, redemption rail, legal approval, token contract, signer, guaranteed price, or public deployment is connected or claimed.

## Accounting model

The version-1 persistent ledger separately records test reserve units, circulating sandbox supply, account balances, and queued redemption liabilities. Its invariant is:

```text
test reserve >= circulating supply + queued redemption liabilities
circulating supply = sum(account balances)
```

A reserve deposit only records operator-supplied test units with a SHA-256 evidence reference. Minting is allowed only against unencumbered reserve and is blocked while paused or while the provider status is `outage`. Redemption immediately burns the user's sandbox balance and circulating supply, then creates a queued liability. Queuing remains available during pause or provider outage so users retain an exit path. Fulfillment is blocked until the provider is available and the sandbox is unpaused, then reduces reserve and the queued liability by the same amount.

The per-account daily mutation limit is 100,000 YUSD and the global daily mutation limit is 1,000,000 YUSD at six decimals. Mint and redemption both consume those limits. Requests require exact idempotency keys; changed reuse fails closed.

Every accepted mutation is included in an integrity-protected state file and a hash-chained audit event bound to the submitted SHA-256 evidence reference. The file is atomically replaced with mode `0600`. Startup rejects integrity, audit, account, redemption, limit, idempotency, solvency, or supply-reconciliation corruption.

## Run locally

Provide a private local API key of at least 16 characters and a writable state path. Do not commit the key.

```bash
YNX_YUSD_SANDBOX_API_KEY="$(openssl rand -hex 24)" \
YNX_YUSD_SANDBOX_STATE_PATH="$PWD/tmp/yusd-sandbox/state.json" \
YNX_YUSD_SANDBOX_ADDR="127.0.0.1:6490" \
go run ./cmd/ynx-yusd-sandboxd
```

Public reads are `GET /health`, `/yusd/snapshot`, `/yusd/accounts/{account}`, `/yusd/redemptions`, and `/yusd/audit`. Mutations under `/yusd/*` require `X-YNX-YUSD-Sandbox-Key` or a bearer value. The service has no public ingress or deployment package, so `installedLocal`, central integration, staging/public deployment, download hosting, production signing, and store release remain false.

## Verification and recovery boundary

```bash
make yusd-sandbox-check
```

The race-enabled check covers reserve/mint/redeem/fulfill reconciliation, provider outage queuing and recovery, pause behavior, exact replay/conflict, daily limits, restart persistence, file mode, tamper rejection, strict JSON, authentication, and truthful health metadata. Copying the stopped state file and its SHA-256 is the current backup mechanism. Restart persistence is tested; a separate operator backup/restore drill, schema migration, remote smoke test, independent reserve attestation, and public proof have not been completed.
