# Testnet Deployment Guide

Run `make preflight` before deployment. This now runs env template checks, no-filler checks, secret scanning, Go tests, and a deployment dry-run that builds the Linux release bundle and renders systemd/nginx/env files without touching a server.

Prepare DNS, TLS, SSH, Postgres, Redis, object storage, wallet keys, validator keys, AI provider, Pay, Trust, monitoring, backup, email, and CI/CD values from `ENV_INTAKE_FORM.md`.

Recommended command order:

```bash
make deploy-dry-run
ENV_FILE=.env.deploy make env-check
ENV_FILE=.env.deploy make deploy-testnet
```

`make deploy-testnet` builds a Linux `ynx-chaind` binary, creates a release tarball under `tmp/deploy`, renders `/etc/ynx/ynx-chaind.env`, renders a hardened systemd service, renders nginx proxy config, uploads the bundle with `scp`, installs the binary and configs through `ssh`, restarts `ynx-chaind`, and reloads nginx if nginx exists on the target host.

For remote operations after deployment:

```bash
ENV_FILE=.env.deploy make status
ENV_FILE=.env.deploy make logs
ENV_FILE=.env.deploy make restart
ENV_FILE=.env.deploy make backup
ROLLBACK_RELEASE=ynx-chain-<commit> ENV_FILE=.env.deploy make rollback
```

After deployment, run `make verify-testnet` and update `docs/public-proof/PUBLIC_TESTNET_PROOF.md` with real endpoint evidence.
