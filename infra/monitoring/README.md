# Monitoring

YNX Chain exposes Prometheus metrics at `GET /metrics`.

## Files

- `prometheus.yml`: scrapes `ynx-chaind:6420/metrics`, `ynx-indexerd:6426/metrics`, and `ynx-explorerd:6427/metrics`.
- `ynx-alerts.yml`: alerts on metrics outage, stalled block height, persistence errors, indexer lag, indexer sync errors, and stale explorer data.
- `grafana-dashboard.json`: starter dashboard for height, transactions, pending transactions, Pay, Trust, contracts, explorer lag, and persistence state.

## Verification

```bash
make monitoring-check
```

The check starts a local YNX Testnet process, reads `/metrics`, validates required metrics, and verifies that the Prometheus, alert, and Grafana files are present and parseable.
