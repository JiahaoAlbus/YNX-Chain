# Monitoring

YNX Chain exposes Prometheus metrics at `GET /metrics`.

## Files

- `prometheus.yml`: scrapes `ynx-chaind:6420/metrics`, `ynx-indexerd:6426/metrics`, `ynx-explorerd:6427/metrics`, and `ynx-faucetd:6428/metrics`.
- `prometheus-authoritative.yml`: production-authoritative scrape topology with one primary loopback target and three distinct follower targets over the existing WireGuard overlay. It contains no public node IP or replication credential.
- `ynx-alerts.yml`: alerts on metrics outage, stalled block height, persistence errors, follower replication freshness/catch-up/lag/failures, indexer lag, indexer sync errors, stale explorer data, and Faucet availability, stale health, readiness, latency, admission-store failure, uncertain results, finite funding balance, or abuse signals.
- `replication-alerts.test.yml`: Prometheus rule tests proving follower replication alerts fire after their configured hold time and clear after recovery.
- `faucet-alerts.test.yml`: Prometheus rule tests for Faucet health freshness, readiness, capability latency, admission errors, uncertain results and finite funding balance.
- `grafana-dashboard.json`: starter dashboard for height, transactions, pending transactions, Pay, Trust, contracts, follower replication health/lag/failures, explorer lag, faucet requests, and persistence state.

## Verification

```bash
make monitoring-check
make authoritative-monitoring-check
make replication-alert-check
make faucet-alert-check
```

The monitoring check starts a local YNX Testnet process, reads `/metrics`, validates required metrics, and verifies that the Prometheus, alert, and Grafana files are present and parseable. The replication alert check runs the production rules through Prometheus `promtool`; it requires a local `promtool` binary or a running Docker daemon and defaults to the pinned `prom/prometheus:v3.11.2` image. Each deployed follower must be scraped as its own `ynx-chaind` target through an approved private route or node-local collector; the repository's single Docker target is only the local stack example. Replication metrics never include the source URL, HMAC key, or bounded error text.

## Faucet incident runbook

Treat `ynx_faucet_health_checked_timestamp_seconds` as the freshness boundary: readiness gauges are evidence from the last completed probe, not a live promise. `ynx_faucet_health_status_duration_seconds`, `ynx_faucet_health_capability_duration_seconds`, and `ynx_faucet_health_admission_duration_seconds` identify the slow or failed stage. `ynx_faucet_funding_ready` is one only after network identity, the durable capability, the admission database, and the applicable funding source are ready.

Authoritative mode mints through the chain-bound Core capability and has no finite treasury balance. It reports `ynx_faucet_funding_balance_applicable 0`; do not interpret its zero balance gauge as depletion. BFT account mode reports applicability one and its last verified YNXT balance. The low-balance alert compares that balance to the configured default grant and cannot fire for authoritative mode.

On `YNXFaucetAdmissionStoreErrors` or `YNXFaucetUncertainResults`, stop automated retries for the affected request but keep the public read-only status path available. Save the exact request ID, service build, health/metrics snapshot, protected logs, admission database metadata and binary checksum. Do not delete, truncate, copy over, or recreate the database; do not run a second writer; do not change the recipient, amount, or request ID. Reconcile the existing deterministic transaction through `/request-status` after Core reads are healthy.

For stale health or capability latency, verify the Faucet process and scrape path, then call `/health` once and inspect `probeFailureStage`. A temporary Core stall is not permission to restart or rewind Core. Roll back only the Faucet binary/unit to the recorded immutable predecessor while retaining the same environment, authority-file reference, request log, and admission database. Validate `/health`, `/metrics`, both Faucet aliases, and request-status reads before restoring write traffic. Never use a health drill to submit a funding request.

`make deploy-authoritative-monitoring` installs checksum-pinned Prometheus on the primary only after a clean-worktree check, validates the config with the matching `promtool`, and requires all four exact targets to report `up=1`. The service listens only on the primary WireGuard address `10.77.42.1:19090`; it does not expose a public Grafana or Prometheus endpoint. Deployment uses the official Prometheus release archive and its GitHub-published SHA-256 digest. The primary downloads and verifies the archive by default; `YNX_PROMETHEUS_ARCHIVE_PATH` may instead point to a regular local cache, which is checked against the same digest before transfer.
