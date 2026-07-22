# Oracle operations

## Runtime boundaries

`ynx-oracled` is a server/CLI product. Native mobile and desktop apps are not appropriate because authoritative aggregation must run continuously in controlled infrastructure. Consumers use the versioned API/SDK; the independent `/oracle` Web/PWA documentation and status surface is a separate required artifact.

The daemon requires:

- A versioned active provider registry whose entries pass legal, rights, coverage, identity, independence, and health review
- `YNX_ORACLE_STATE_HMAC_KEY_HEX`, injected through an approved secret manager and decoding to at least 32 bytes
- A persistent state path on an encrypted, backed-up volume
- A unique nonce domain for the network and environment
- A public API listen address behind approved TLS/proxy controls
- A loopback-only metrics address for Monitor scraping through the private monitoring path

The daemon fails startup when the registry or integrity key is absent/invalid. It does not ship active mock providers.

## Build and start

```sh
go build -trimpath -ldflags "-X github.com/JiahaoAlbus/YNX-Chain/internal/oracle.BuildCommit=$SOURCE_COMMIT" -o ynx-oracled ./cmd/ynx-oracled
YNX_ORACLE_STATE_HMAC_KEY_HEX="$SECRET_MANAGER_VALUE" ./ynx-oracled \
  --providers /etc/ynx/oracle/providers.v1.json \
  --state /var/lib/ynx/oracle/state.json \
  --nonce-domain ynx-oracle-testnet-v1 \
  --listen 127.0.0.1:6470 \
  --metrics-listen 127.0.0.1:9470
```

`$SECRET_MANAGER_VALUE` is a reference to operator-side injection. Secrets must not be placed in shell history, source files, release records, or support tickets.

## Health and smoke

1. Verify `/version` reports the expected immutable source commit, schema, and policy.
2. Verify `/health` is `ok` only when the active provider count meets policy and no emergency pause applies.
3. Submit separately signed observations from the approved minimum independent reporters.
4. Verify `/prices` includes the expected market/type, source, version, `asOf`, confidence, coverage, hashes, lineage, and `quality.status=good`.
5. Verify stale, divergent, wrong-domain, tampered, replayed, unregistered, and rate-limited vectors fail with the documented status and error ID.
6. Verify public `/metrics` is 404 and the loopback metrics listener is reachable only through the private Monitor path.

## Backup and restore

Use `Store.Backup` or a stopped-service filesystem snapshot to copy the entire integrity-protected envelope to an access-controlled immutable destination. A backup is not successful until `OpenStore` verifies it with the correct nonce domain/key and its event-chain hash matches the live source. Record source commit, state generation, bytes, SHA-256, start/end times, operator audit ID, destination class, and retention.

Restore into a new path first, verify integrity and replay representative markets/corrections/controls, then atomically switch the stopped daemon. Never overwrite the only live copy. Current automated tests prove a local backup/restore drill; off-host RTO/RPO evidence remains pending.

## Incident response

1. Detect and assign request/error/audit IDs.
2. Classify provider outage, divergence, manipulation, key compromise, clock failure, store failure, consumer misuse, or deployment failure.
3. If publication is unsafe, apply an approved audited emergency pause through the canonical operator-control path. The local store primitive is implemented, but an unauthenticated HTTP control route is intentionally absent.
4. Continue raw signed ingestion when safe so investigation and replay retain evidence.
5. Notify affected consumers and public status channels with source limitations and no price guarantees.
6. Remove/rotate a provider only through versioned governance, notice, appeal, and reporter-key procedures.
7. Resume only after independent-source health, replay, correction, and consumer checks pass and the approval audit is recorded.
8. Publish a post-incident record and update thresholds/runbooks.

## Support, disputes, and recovery

Support must accept error/audit IDs, timestamp, endpoint, market/type, client version, and non-secret response metadata. Users must never send private keys, seeds, reporter keys, integrity keys, session tokens, or full provider credentials. Oracle itself does not hold user funds and cannot issue trading refunds; fee/refund or settlement disputes route to the consuming product with the exact Oracle lineage and source commit attached.

## Current operational limitations

- No active legally approved three-provider registry exists.
- No canonical Wallet/App Gateway operator-control route is integrated.
- No public endpoint, dashboard, status page, Alertmanager route, off-host backup, or remote restore drill is proven.
- The base repository’s full test target still requires generated Solidity artifacts unrelated to this product.
