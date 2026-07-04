# docker

This directory is part of the YNX Chain engineering surface. It is intentionally separated so runtime code, deployment assets, and review packages do not collapse into the website repository.

`docker-compose.yml` runs `ynx-chaind`, `ynx-indexerd`, `ynx-explorerd`, `ynx-faucetd`, Prometheus, and Grafana for local operations review. The indexer reads `ynx-chaind:6420`, persists its JSON database in the `ynx-indexer-data` volume, and exposes health, indexed blocks, transactions, and metrics on port `6426`. The explorer reads both RPC and indexer data and exposes web/API/metrics on port `6427`. The faucet reads RPC, enforces rate limits, writes request logs, and exposes health/metrics/request endpoints on port `6428`.

```bash
MONITORING_ADMIN_PASSWORD=local-dev-only docker compose -f infra/docker/docker-compose.yml up --build
```
