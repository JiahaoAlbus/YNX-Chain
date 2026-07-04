# Operations Runbook

Local service: `make devnet`; health: `curl /health`; status: `curl /status`; metrics: `curl /metrics`; logs: process stdout.

Remote deployment and service management:

```bash
ENV_FILE=.env.deploy make deploy-testnet
ENV_FILE=.env.deploy make status
ENV_FILE=.env.deploy make logs
ENV_FILE=.env.deploy make restart
ENV_FILE=.env.deploy make backup
ROLLBACK_RELEASE=ynx-chain-<commit> ENV_FILE=.env.deploy make rollback
```

The deployment first SSH-prechecks the primary, Singapore, Silicon Valley, and Seoul nodes. If any host key, key path, user, or `systemctl` check fails, deployment stops before modifying any remote node. The primary node receives `ynx-chaind`, `ynx-indexerd`, `ynx-explorerd`, and `ynx-faucetd`; Singapore, Silicon Valley, and Seoul receive validator-only `ynx-chaind` installs. Every node captures a pre-deploy status report under `/var/log/ynx-chain/deploy/` and writes a best-effort pre-deploy backup under `BACKUP_STORAGE_PATH` before release files are installed.

The deployment writes `/etc/systemd/system/ynx-chaind.service`, `/etc/ynx/ynx-chaind.env`, `/usr/local/bin/ynx-chaind`, `/var/lib/ynx-chain/testnet`, and `/var/log/ynx-chain` on all nodes. On the primary node it also writes `/etc/systemd/system/ynx-indexerd.service`, `/etc/systemd/system/ynx-explorerd.service`, `/etc/systemd/system/ynx-faucetd.service`, `/usr/local/bin/ynx-indexerd`, `/usr/local/bin/ynx-explorerd`, `/usr/local/bin/ynx-faucetd`, and `/var/lib/ynx-chain/indexer`. nginx config is installed to `/etc/nginx/conf.d/ynx-chain.conf` on the primary when nginx is present.

Remote verification:

```bash
make host-key-audit
make legacy-inventory
ENV_FILE=.env.deploy make remote-smoke-test
ENV_FILE=.env.deploy make verify-testnet
make remote-blocker-report
ENV_FILE=.env.deploy make public-proof
```

`host-key-audit` records local known-host entries, currently presented host-key fingerprints, and strict SSH results for the primary, Singapore, Silicon Valley, and Seoul nodes. It does not rewrite `~/.ssh/known_hosts`; changed fingerprints must be independently verified before any known-host entry is replaced. `legacy-inventory` is a strict, read-only remote inventory of reachable nodes. It records current service states, relevant listening ports, config-file presence and hashes, common local health/chainId probes, and data-directory outlines without printing env file contents. Run it before replacing any public service so old `ynx_9102-1` state, ingress, and rollback boundaries are explicit. `remote-smoke-test` checks the public RPC, EVM RPC, REST, faucet, indexer, explorer, AI Gateway, and Web4 Hub endpoints. It refuses to run mutable proof calls such as faucet funding and Pay/IDE writes until the public endpoints prove they are the new YNX Testnet, not the old `ynx_9102-1` service. `verify-testnet` adds SSH and systemd checks for the four nodes and treats SSH host-key changes as blockers. `remote-blocker-report` turns the latest `verify-testnet` evidence into `tmp/verify-testnet/REMOTE_BLOCKERS.md` for handoff when public endpoints still point at old-chain services or SSH safety gates fail. `public-proof` creates a remote evidence package only; failed packages are diagnostics, not completed proof.

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

Explorer readiness:

```bash
make explorer-check
```

`ynx-explorerd` reads RPC state plus indexed block/transaction data, serves the Explorer web UI and `/api/*` endpoints, exposes MetaMask network metadata with native currency `YNXT`, and reports health plus Prometheus metrics on `YNX_EXPLORER_HTTP_ADDR`.

Faucet readiness:

```bash
make faucet-check
```

`ynx-faucetd` requires `FAUCET_PRIVATE_KEY` from env, validates request addresses, enforces rate limits, writes JSONL request logs, funds YNXT through the chain RPC, and exposes health plus Prometheus metrics on `YNX_FAUCET_HTTP_ADDR`.

Emergency process: stop public writes, preserve logs, snapshot state, communicate incident, roll back only from verified backups.
