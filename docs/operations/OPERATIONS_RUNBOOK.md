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

The deployment writes `/etc/systemd/system/ynx-chaind.service`, `/etc/ynx/ynx-chaind.env`, `/usr/local/bin/ynx-chaind`, `/var/lib/ynx-chain/testnet`, and `/var/log/ynx-chain`. nginx config is installed to `/etc/nginx/conf.d/ynx-chain.conf` when nginx is present.

Monitoring readiness:

```bash
make monitoring-check
```

Prometheus config lives in `infra/monitoring/prometheus.yml`, alert rules in `infra/monitoring/ynx-alerts.yml`, and the starter dashboard in `infra/monitoring/grafana-dashboard.json`.

Emergency process: stop public writes, preserve logs, snapshot state, communicate incident, roll back only from verified backups.
