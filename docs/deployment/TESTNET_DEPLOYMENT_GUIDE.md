# Testnet Deployment Guide

Run `make preflight` before deployment. This now runs env template checks, no-filler checks, secret scanning, Go tests, a multi-node deployment dry-run, and a multi-node ops dry-run without touching a server.

Prepare DNS, TLS, SSH, Postgres, Redis, object storage, wallet keys, validator keys, AI provider, Pay, Trust, monitoring, backup, email, and CI/CD values from `ENV_INTAKE_FORM.md`.

Recommended command order:

```bash
make deploy-dry-run
make ops-check
ENV_FILE=.env.deploy make env-check
make host-key-audit
YNX_REMOTE_TIMEOUT_MS=5000 YNX_REMOTE_BLOCK_GROWTH_DELAY_MS=1000 YNX_REMOTE_EVIDENCE_PATH=tmp/verify-testnet/remote-evidence.json make remote-smoke-test
make remote-blocker-report
ENV_FILE=.env.deploy make deploy-readiness-gate
ENV_FILE=.env.deploy make deploy-testnet
```

`make deploy-testnet` builds Linux binaries for `ynx-chaind`, `ynx-indexerd`, `ynx-explorerd`, and `ynx-faucetd`, creates a release tarball under `tmp/deploy`, renders `/etc/ynx/ynx-chaind.env`, systemd units, and nginx proxy config, then runs `deploy-readiness-gate` before any remote mutation. The gate reads `tmp/verify-testnet/remote-blockers.json` and refuses deployment when SSH or public ingress evidence is not coherent. After the gate passes, deployment SSH-prechecks the primary, Singapore, Silicon Valley, and Seoul nodes before modifying any server. The primary node receives the full RPC/indexer/explorer/faucet stack. Singapore, Silicon Valley, and Seoul receive validator-only `ynx-chaind` installs. Each node captures pre-deploy status and a best-effort backup before release files are installed.

For remote operations after deployment:

```bash
ENV_FILE=.env.deploy make status
ENV_FILE=.env.deploy make logs
ENV_FILE=.env.deploy make restart
ENV_FILE=.env.deploy make backup
ROLLBACK_RELEASE=ynx-chain-<commit> ENV_FILE=.env.deploy make rollback
```

After deployment, run `make verify-testnet` and update `docs/public-proof/PUBLIC_TESTNET_PROOF.md` with real endpoint evidence.
The post-deploy ops commands are multi-node aware: primary operations cover `ynx-chaind`, `ynx-indexerd`, `ynx-explorerd`, and `ynx-faucetd`; validator node operations cover `ynx-chaind`.
