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

The deployment first SSH-prechecks the primary, Singapore, Silicon Valley, and Seoul nodes. If any host key, key path, user, or `systemctl` check fails, deployment stops before modifying any remote node. The primary node receives `ynx-chaind`, `ynx-indexerd`, `ynx-explorerd`, and `ynx-faucetd`; Singapore, Silicon Valley, and Seoul receive validator-only `ynx-chaind` installs. Every node captures a pre-deploy status report under `/var/log/ynx-chain/deploy/` and writes a best-effort pre-deploy backup under `BACKUP_STORAGE_PATH` before release files are installed. Backups include new YNX Chain paths plus legacy `ynx-v2-*` systemd units, Caddy ingress config, `.ynx-v2` data directories, and the Singapore observer path when present; these backups stay on the remote hosts and are not committed.

The deployment writes `/etc/systemd/system/ynx-chaind.service`, `/etc/ynx/ynx-chaind.env`, `/usr/local/bin/ynx-chaind`, `/var/lib/ynx-chain/testnet`, and `/var/log/ynx-chain` on all nodes. On the primary node it also writes `/etc/systemd/system/ynx-indexerd.service`, `/etc/systemd/system/ynx-explorerd.service`, `/etc/systemd/system/ynx-faucetd.service`, `/usr/local/bin/ynx-indexerd`, `/usr/local/bin/ynx-explorerd`, `/usr/local/bin/ynx-faucetd`, and `/var/lib/ynx-chain/indexer`. nginx config is installed to `/etc/nginx/conf.d/ynx-chain.conf` on the primary when nginx is present.

Each deploy bundle includes `config/release-manifest.json`. The manifest is non-secret and records the release name, git commit, build time, target chain, binary paths, role env paths, service config paths, file sizes, and SHA-256 checksums. `make deploy-dry-run` verifies that the manifest matches the generated bundle. `verify-testnet` checks the remote manifest under `/opt/ynx-chain/releases/<release>/config/release-manifest.json`, compares the installed `/usr/local/bin/ynx-chaind` SHA-256 against the manifest, and then requires live `/status.build` and `/node/identity.build` to report the same release commit/name. This binds runtime identity to the deployed artifact, but it is still not remote public proof unless public endpoint checks also pass.

Remote verification:

```bash
make host-key-audit
make host-key-repair-plan
make host-key-approval-template
make host-key-approval-request
make host-key-approval-packet
make host-key-approval-status
make host-key-approval-check
make host-key-approved-repair-dry-run
make host-key-approved-repair
make legacy-inventory
ENV_FILE=.env.deploy make remote-smoke-test
ENV_FILE=.env.deploy make verify-testnet
make remote-blocker-report
ENV_FILE=.env.deploy make deploy-readiness-gate
ENV_FILE=.env.deploy make public-proof
```

`host-key-audit` records local known-host entries, currently presented host-key fingerprints, and strict SSH results for the primary, Singapore, Silicon Valley, and Seoul nodes. It does not rewrite `~/.ssh/known_hosts`; changed fingerprints must be independently verified before any known-host entry is replaced. `host-key-repair-plan` writes a non-mutating operator plan under `tmp/host-key-audit`; `host-key-approval-request` writes a concise external-verification request with untrusted current-scan fingerprints and blank trusted-fingerprint fields, skipping strict-failed nodes without valid scan fingerprints as SSH/keyscan blockers; `host-key-approval-packet` writes a reviewer-facing markdown/JSON packet with the same untrusted current-scan fingerprints, a blank approval draft, evidence requirements, and follow-up commands for cloud-console/provider confirmation; `host-key-approval-status` writes a non-mutating markdown/JSON status showing whether ignored `.host-key-approvals.json` exists/readable, which mismatch fingerprints still need trusted confirmation, and which strict-failed nodes were skipped. If fingerprints are confirmed through a trusted external channel, record them in ignored `.host-key-approvals.json` with `source`, `approvedAt`, `approvedBy`, `verificationChannel`, top-level `evidence`, and per-node `evidence`, require `make host-key-approval-check` to pass, run `make host-key-approved-repair-dry-run`, and only then run `make host-key-approved-repair`. Both repair targets fail closed before touching `known_hosts` unless the approval check passes. `legacy-inventory` is a strict, read-only remote inventory of reachable nodes. It records current service states, relevant listening ports, config-file presence and hashes, common local health/chainId probes, and data-directory outlines without printing env file contents. Run it before replacing any public service so old `ynx_9102-1` state, ingress, and rollback boundaries are explicit. `remote-smoke-test` checks the public RPC, EVM RPC, REST, gRPC, faucet, indexer, explorer, AI Gateway, and Web4 Hub endpoints. It refuses to run mutable proof calls such as faucet funding and Pay/IDE writes until the public endpoints prove they are the new YNX Testnet, not the old `ynx_9102-1` service. `verify-testnet` adds SSH and systemd checks for the four nodes and treats SSH host-key changes as blockers. `remote-blocker-report` turns the latest evidence into `tmp/verify-testnet/REMOTE_BLOCKERS.md` plus `tmp/verify-testnet/remote-blockers.json`; it classifies SSH, host-key, legacy-chain, wrong-chain, timeout, HTTP blockers, and freshness for required host-key/remote-smoke/approval-status source evidence. `deploy-readiness-gate` reads that JSON and blocks `deploy-testnet` mutations while SSH access, public ingress evidence, required source evidence freshness, or approval status is unsafe. `public-proof` creates a remote evidence package only; failed packages are diagnostics, not completed proof.

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
