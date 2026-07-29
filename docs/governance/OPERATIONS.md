# Governance operations

`ynx-governanced` is a loopback-only control-plane service. The central App Gateway authenticates the user session and forwards a short-lived, body-bound internal assertion. Governance resolves roles and object scopes from its own authoritative state.

## Startup

Run `ynx-governanced --check-config --config /etc/ynx-chain/governance/config.json` before starting the service. The check validates the versioned policy, pinned genesis-role hash, loopback address, absolute paths, and mode-`0600` Gateway assertion key. It does not claim installation or deployment.

The service refuses to start if persisted policy differs from runtime policy. Policy changes must therefore use a versioned migration and governance evidence; editing the config alone cannot upgrade policy.

## Health and monitoring

- `GET /health` returns counts, persistence class, truthful local deployment status, and `externalExecution=false`.
- `GET /metrics` returns bounded aggregate metrics without account, proposal, evidence, or target labels.
- Responses include `X-Request-ID`; failures include `X-YNX-Error-ID`.
- Structured access logs include method, coarse route class, status, duration, and request ID. They omit record IDs, request bodies, identities, and credentials.

Alert on service unavailability, restart loops, state-integrity startup failure, active emergency actions nearing expiry, timelocks ready but not executed, and failed execution verification.

## Backup and restore

Use `ynx-governance-state --action backup` to create a mode-`0600` state artifact and machine-readable record containing SHA-256, bytes, timestamp, and state schema. Restore verifies both hashes, loads and validates the complete snapshot, checks policy equality, and preserves the current valid state as a timestamped pre-restore artifact before replacement.

Run restore only while `ynx-governanced` is stopped. After restore, run `ynx-governance-state --action verify`, start the service, query health, and compare proposal, role, and emergency counts with the backup record and incident log.

## Incident boundaries

Emergency Council actions only pause an approved Bridge, Oracle Route, Market, Vault, Provider, or Upgrade target. They cannot move assets, mint or burn, change ownership, restore a revoked mandate, or make a permanent parameter change. Expiry is automatic and closure requires a public follow-up proposal.
