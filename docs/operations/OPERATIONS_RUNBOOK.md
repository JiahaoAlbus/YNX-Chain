# Operations Runbook

Local service: `make devnet`; health: `curl /health`; status: `curl /status`; metrics: `curl /metrics`; logs: process stdout.

Remote service:

```bash
ENV_FILE=.env.deploy make status
ENV_FILE=.env.deploy make logs
ENV_FILE=.env.deploy make restart
ENV_FILE=.env.deploy make backup
ROLLBACK_RELEASE=ynx-chain-<commit> ENV_FILE=.env.deploy make rollback
```

The deployment writes `/etc/systemd/system/ynx-chaind.service`, `/etc/systemd/system/ynx-indexerd.service`, `/etc/ynx/ynx-chaind.env`, `/usr/local/bin/ynx-chaind`, `/usr/local/bin/ynx-indexerd`, `/var/lib/ynx-chain/testnet`, `/var/lib/ynx-chain/indexer`, and `/var/log/ynx-chain`. nginx config is installed to `/etc/nginx/conf.d/ynx-chain.conf` when nginx is present.

Monitoring readiness:

```bash
make monitoring-check
```

Prometheus config lives in `infra/monitoring/prometheus.yml`, alert rules in `infra/monitoring/ynx-alerts.yml`, and the starter dashboard in `infra/monitoring/grafana-dashboard.json`.

Indexer readiness:

```bash
make indexer-check
```

`ynx-indexerd` syncs from the YNX Chain RPC, persists indexed blocks and transactions, resumes from the last indexed height, and exposes health and Prometheus metrics on `YNX_INDEXER_HTTP_ADDR`.

Emergency process: stop public writes, preserve logs, snapshot state, communicate incident, roll back only from verified backups.
