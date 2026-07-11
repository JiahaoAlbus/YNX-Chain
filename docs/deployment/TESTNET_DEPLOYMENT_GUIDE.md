# Testnet Deployment Guide

Run `make preflight` before deployment. This now runs env template checks, no-filler checks, secret scanning, Go tests, a multi-node deployment dry-run, and a multi-node ops dry-run without touching a server.

Prepare DNS, TLS, SSH, Postgres, Redis, object storage, wallet keys, validator keys, AI provider, Pay, Trust, monitoring, backup, email, and CI/CD values from `ENV_INTAKE_FORM.md`.

Recommended command order:

```bash
make deploy-dry-run
make ops-check
ENV_FILE=.env.deploy make env-check
make host-key-audit
make host-key-repair-plan
make host-key-approval-template
make host-key-approval-request
make host-key-approval-packet
make host-key-approval-check
make host-key-approved-repair-dry-run
make host-key-approved-repair
YNX_REMOTE_TIMEOUT_MS=5000 YNX_REMOTE_BLOCK_GROWTH_DELAY_MS=1000 YNX_REMOTE_EVIDENCE_PATH=tmp/verify-testnet/remote-evidence.json make remote-smoke-test
make remote-blocker-report
ENV_FILE=.env.deploy make deploy-readiness-gate
ENV_FILE=.env.deploy make deploy-testnet
```

For the first installation of a release that cannot already have passed public proof, refresh `make legacy-inventory`, `make host-key-audit`, `make remote-smoke-test`, and `make remote-blocker-report`, then use the explicit bootstrap flag:

```bash
YNX_BOOTSTRAP_DEPLOY=1 ENV_FILE=.env.deploy make deploy-testnet
```

Bootstrap mode still requires fresh current-HEAD remote evidence, a fresh legacy deployment inventory, no source-evidence blockers, and no SSH/host-key blockers. It only permits the recorded pre-deployment public endpoint failures that the new release is intended to replace. The deployment path captures pre-deploy state and creates per-node backups before installing or restarting services. Do not use bootstrap mode for routine upgrades after the current release has valid public proof.

If a node cannot safely hold its own full pre-deploy archive, stream the archive to a separate trusted backup host, validate the archive there, record its SHA-256, and write `/var/log/ynx-chain/deploy/offnode-backup-<release>-<role>.txt` on the source node. The evidence file must contain exact `status=validated`, `release=<release>`, `role=<role>`, and `sha256=<64 lowercase hex>` rows. Only then may the operator set `YNX_ALLOW_OFFNODE_BACKUP=1`; without both the explicit flag and current release-bound evidence, deployment still requires a validated local archive.

Multi-node peer polling requires `YNX_NODE_HTTP_ADDR=0.0.0.0:6420` on the four validator hosts. Restrict inbound TCP 6420 at the cloud firewall to the four validator public IPs; do not expose it to arbitrary internet sources. Public clients should continue to use the HTTPS RPC/REST domains.

`make deploy-testnet` builds Linux binaries for `ynx-chaind`, `ynx-indexerd`, `ynx-explorerd`, and `ynx-faucetd`, creates a release tarball under `tmp/deploy`, renders `/etc/ynx/ynx-chaind.env`, systemd units, and nginx proxy config, then runs `deploy-readiness-gate` before any remote mutation. The gate reads `tmp/verify-testnet/remote-blockers.json` and refuses deployment when SSH evidence, public ingress evidence, or required source evidence freshness is not coherent. A newly generated blocker JSON is not enough; the underlying host-key audit and remote smoke evidence must also exist and be fresh. If host keys changed, run `make host-key-approval-request` and `make host-key-approval-packet`, compare the presented fingerprints against an independently trusted cloud-console/provider source, write only confirmed fingerprints, the current `hostKeyAuditSha256`, and trusted-verification metadata to ignored `.host-key-approvals.json`, require `make host-key-approval-check` to pass, run `make host-key-approved-repair-dry-run`, and only then run `make host-key-approved-repair`. After the gate passes, deployment SSH-prechecks the primary, Singapore, Silicon Valley, and Seoul nodes before modifying any server. The primary node receives the full RPC/indexer/explorer/faucet stack. Singapore, Silicon Valley, and Seoul receive validator-only `ynx-chaind` installs. Each node captures pre-deploy status and a best-effort backup before release files are installed.

The ignored `.host-key-approvals.json` file must include `hostKeyAuditSha256`, `source`, `approvedAt`, `approvedBy`, `verificationChannel`, `evidence`, and `nodes`. Each node entry must include `role`, `host`, `evidence`, and exact `fingerprints` keyed by presented key type such as `ED25519`, `ECDSA`, and `RSA`. The approval check compares the approval `hostKeyAuditSha256` to the current `tmp/host-key-audit/host-key-audit.txt` SHA-256, then compares every currently presented scanned key type against that file and fails closed on missing metadata, stale audit hash, missing node evidence, extra key types, or mismatched values.

`host-key-approval-status.json` also carries the trusted approval metadata and the current host-key audit SHA-256. `remote-blocker-report` rejects an `approved-current-scan` status that lacks this metadata or whose approved/current audit SHA-256 does not match the current host-key audit report, so old or stale status files generated before the auditable approval schema cannot unblock deployment.

`make host-key-approval-packet` writes `tmp/host-key-audit/HOST_KEY_EXTERNAL_APPROVAL_PACKET.md` and JSON. The packet is designed for an external reviewer: it includes the untrusted current-scan fingerprints, the exact host-key audit report path and SHA-256, a blank approval draft, required evidence fields, and the exact follow-up commands. It is not a trusted approval file and does not modify `known_hosts`; the blocker report rejects packet JSON whose audit SHA-256 no longer matches the current host-key audit report.

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
