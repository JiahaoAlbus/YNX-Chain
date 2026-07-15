# Monitoring

YNX Chain exposes Prometheus metrics at `GET /metrics`.

## Files

- `prometheus.yml`: scrapes `ynx-chaind:6420/metrics`, `ynx-indexerd:6426/metrics`, `ynx-explorerd:6427/metrics`, and `ynx-faucetd:6428/metrics`.
- `ynx-alerts.yml`: alerts on metrics outage, stalled block height, persistence errors, follower replication freshness/catch-up/lag/failures, indexer lag, indexer sync errors, stale explorer data, and faucet availability or abuse signals.
- `grafana-dashboard.json`: starter dashboard for height, transactions, pending transactions, Pay, Trust, contracts, follower replication health/lag/failures, explorer lag, faucet requests, and persistence state.

## Verification

```bash
make monitoring-check
```

The check starts a local YNX Testnet process, reads `/metrics`, validates required metrics, and verifies that the Prometheus, alert, and Grafana files are present and parseable. Each deployed follower must be scraped as its own `ynx-chaind` target through an approved private route or node-local collector; the repository's single Docker target is only the local stack example. Replication metrics never include the source URL, HMAC key, or bounded error text.
