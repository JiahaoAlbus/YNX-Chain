# Monitoring

YNX Chain exposes Prometheus metrics at `GET /metrics`.

## Files

- `prometheus.yml`: scrapes `ynx-chaind:6420/metrics`, `ynx-indexerd:6426/metrics`, `ynx-explorerd:6427/metrics`, and `ynx-faucetd:6428/metrics`.
- `ynx-alerts.yml`: alerts on metrics outage, stalled block height, persistence errors, follower replication freshness/catch-up/lag/failures, indexer lag, indexer sync errors, stale explorer data, and faucet availability or abuse signals.
- `replication-alerts.test.yml`: Prometheus rule tests proving follower replication alerts fire after their configured hold time and clear after recovery.
- `grafana-dashboard.json`: starter dashboard for height, transactions, pending transactions, Pay, Trust, contracts, follower replication health/lag/failures, explorer lag, faucet requests, and persistence state.

## Verification

```bash
make monitoring-check
make replication-alert-check
```

The monitoring check starts a local YNX Testnet process, reads `/metrics`, validates required metrics, and verifies that the Prometheus, alert, and Grafana files are present and parseable. The replication alert check runs the production rules through Prometheus `promtool`; it requires a local `promtool` binary or a running Docker daemon and defaults to the pinned `prom/prometheus:v2.55.1` image. Each deployed follower must be scraped as its own `ynx-chaind` target through an approved private route or node-local collector; the repository's single Docker target is only the local stack example. Replication metrics never include the source URL, HMAC key, or bounded error text.
