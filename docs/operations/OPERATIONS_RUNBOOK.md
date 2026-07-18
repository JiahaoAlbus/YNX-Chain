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

The deployment first SSH-prechecks the primary, Singapore, Silicon Valley, and Seoul nodes. If any host key, key path, user, or `systemctl` check fails, deployment stops before modifying any remote node. The primary node receives `ynx-chaind`, `ynx-indexerd`, `ynx-explorerd`, `ynx-faucetd`, and `ynx-ai-gatewayd`; Singapore, Silicon Valley, and Seoul receive validator-only `ynx-chaind` installs. Every node captures a pre-deploy status report under `/var/log/ynx-chain/deploy/` and writes a best-effort pre-deploy backup under `BACKUP_STORAGE_PATH` before release files are installed. Backups include new YNX Chain paths plus legacy `ynx-v2-*` systemd units, Caddy ingress config, `.ynx-v2` data directories, and the Singapore observer path when present; these backups stay on the remote hosts and are not committed.

The deployment writes `/etc/systemd/system/ynx-chaind.service`, `/etc/ynx/ynx-chaind.env`, `/usr/local/bin/ynx-chaind`, `/var/lib/ynx-chain/testnet`, and `/var/log/ynx-chain` on all nodes. On the primary node it also writes `/etc/systemd/system/ynx-indexerd.service`, `/etc/systemd/system/ynx-explorerd.service`, `/etc/systemd/system/ynx-faucetd.service`, `/etc/systemd/system/ynx-ai-gatewayd.service`, `/etc/ynx/ynx-ai-gatewayd.env` with mode `0600`, `/usr/local/bin/ynx-indexerd`, `/usr/local/bin/ynx-explorerd`, `/usr/local/bin/ynx-faucetd`, `/usr/local/bin/ynx-ai-gatewayd`, and `/var/lib/ynx-chain/indexer`. nginx config is installed to `/etc/nginx/conf.d/ynx-chain.conf` on the primary when nginx is present; the AI domain has a dedicated non-buffered proxy to port `6429`.

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

`host-key-audit` records local known-host entries, currently presented host-key fingerprints, and strict SSH results for the primary, Singapore, Silicon Valley, and Seoul nodes. It does not rewrite `~/.ssh/known_hosts`; changed fingerprints must be independently verified before any known-host entry is replaced. `host-key-repair-plan` writes a non-mutating operator plan under `tmp/host-key-audit`; `host-key-approval-request` writes a concise external-verification request with untrusted current-scan fingerprints and blank trusted-fingerprint fields, skipping strict-failed nodes without valid scan fingerprints as SSH/keyscan blockers; `host-key-approval-packet` writes a reviewer-facing markdown/JSON packet with the same untrusted current-scan fingerprints, the exact host-key audit report SHA-256, a blank approval draft, evidence requirements, and follow-up commands for cloud-console/provider confirmation; `host-key-approval-status` writes a non-mutating markdown/JSON status showing whether ignored `.host-key-approvals.json` exists/readable, the current and approved host-key audit SHA-256 values, which mismatch fingerprints still need trusted confirmation, and which strict-failed nodes were skipped. If fingerprints are confirmed through a trusted external channel, record them in ignored `.host-key-approvals.json` with the current `hostKeyAuditSha256`, `source`, `approvedAt`, `approvedBy`, `verificationChannel`, top-level `evidence`, and per-node `evidence`, require `make host-key-approval-check` to pass, run `make host-key-approved-repair-dry-run`, and only then run `make host-key-approved-repair`. Both repair targets fail closed before touching `known_hosts` unless the approval check passes. `legacy-inventory` is a strict, read-only remote inventory of reachable nodes. It records current service states, relevant listening ports, config-file presence and hashes, common local health/chainId probes, and data-directory outlines without printing env file contents. Run it before replacing any public service so old `ynx_9102-1` state, ingress, and rollback boundaries are explicit. `remote-smoke-test` checks the public RPC, EVM RPC, REST, gRPC, faucet, indexer, explorer, AI Gateway, and Web4 Hub endpoints. It refuses to run mutable proof calls such as faucet funding and Pay/IDE writes until the public endpoints prove they are the new YNX Testnet, not the old `ynx_9102-1` service. `verify-testnet` adds SSH and systemd checks for the four nodes and treats SSH host-key changes as blockers. `remote-blocker-report` turns the latest evidence into `tmp/verify-testnet/REMOTE_BLOCKERS.md` plus `tmp/verify-testnet/remote-blockers.json`; it classifies SSH, host-key, legacy-chain, wrong-chain, timeout, HTTP blockers, and freshness for required host-key/remote-smoke/approval-status source evidence. It also rejects approval packets, approval files, or approved status JSON whose audit SHA-256 no longer matches the current host-key audit report. `deploy-readiness-gate` reads that JSON and blocks `deploy-testnet` mutations while SSH access, public ingress evidence, required source evidence freshness, or approval status is unsafe. `public-proof` creates a remote evidence package only; failed packages are diagnostics, not completed proof.

Monitoring readiness:

```bash
make monitoring-check
```

Prometheus config lives in `infra/monitoring/prometheus.yml`, alert rules in `infra/monitoring/ynx-alerts.yml`, and the starter dashboard in `infra/monitoring/grafana-dashboard.json`.

Indexer readiness:

```bash
make indexer-check
```

`ynx-indexerd` syncs from the YNX Chain RPC, persists indexed blocks and transactions, bootstraps from the reported earliest retained height, resumes only when the next parent hash matches the stored tip, and exposes the source earliest boundary through health/overview/Prometheus metrics on `YNX_INDEXER_HTTP_ADDR`. A `rebuild required` error means the stored resume point was pruned, source identity/height regressed, or canonical hash continuity failed; preserve the database for evidence before rebuilding from the currently reported earliest boundary.

Explorer readiness:

```bash
make explorer-check
```

`ynx-explorerd` reads RPC state plus indexed block/transaction data, serves the Explorer web UI and `/api/*` endpoints, exposes MetaMask network metadata with native currency `YNXT`, and reports health plus Prometheus metrics on `YNX_EXPLORER_HTTP_ADDR`.

Faucet readiness:

```bash
make faucet-check
```

`ynx-faucetd` validates request addresses, enforces rate limits, writes JSONL request logs, and exposes health plus Prometheus metrics on `YNX_FAUCET_HTTP_ADDR`. Keep `YNX_FAUCET_UPSTREAM_MODE=authoritative` while the public network uses the rollback-compatible runtime. BFT mode requires chain ID `6423`, a configured Faucet address matching exactly one process-local key source, and a loopback BFT Gateway URL; it queries nonce/balance, signs locally, broadcasts only the signed envelope, and fails closed on inconsistent commit evidence. A raw key file must be regular, mode-restricted, and readable by the Faucet service account.

AI Gateway readiness:

```bash
make ai-gateway-check
make bft-ai-action-check
```

`ynx-ai-gatewayd` requires provider and public access keys in both modes. Keep `YNX_AI_GATEWAY_UPSTREAM_MODE=authoritative` for the current rollback-compatible public runtime; its chain routes require the separate upstream key. Candidate `bft` mode requires a canonical signer address and exactly one process-local raw key source, preferably a mode-`0600` key file. It serializes nonce query/sign/broadcast, never forwards key material, and rejects inconsistent commit or ABCI record evidence. `make bft-ai-action-check` covers the signed BFT mutation path locally; it does not authorize public routing.

YNX AI independent product release operations:

- Treat `apps/ai/product-release.json` as the status source. Do not infer staging, central integration, provider liveness, hosted download, production signing, or store release from a feature branch or local artifact.
- Keep `YNX_AI_ALLOW_LOCAL_FIXTURE_AUTH` unset/`0` outside isolated tests. The server deliberately fails closed until canonical Wallet Auth integration is deployed.
- Start the local server only with an absolute state path, a 32-byte content key, a private Gateway URL/key, and the exact callback. `/healthz` proves only the local process/build truth fields.
- A production promotion gate must require `integratedCentral=true` from deployed canonical registry/session introspection, central `POST /ai/stream`, and remote smoke; never edit the product manifest to bypass that evidence.
- Provider output is live only after non-empty provider-backed Gateway SSE succeeds. A configured key/model, local fixture response, handler test, 429, or provider-unavailable response leaves `generationLive=false`.
- Build Android with `NODE_ENV=production` and explicit SDK paths. Record APK hash, bytes, min/target SDK and the actual certificate DN/digest. An Android Debug certificate is test-signed, never production-signed.
- This host lacks Xcode. Run `.github/workflows/ynx-ai-mobile.yml` on macOS and retain the iOS Simulator artifact/hash plus install/cold-launch/restart/deep-link logs before marking iOS tested or installed.
- Before release, run Go tests/vet/race, mobile typecheck/tests/product checks/bundles, Web smoke, secret/placeholder/license/SBOM checks, `git diff --check`, then reconcile every field in product-release/artifact/evidence/UI audit files.

Pay Gateway readiness:

```bash
make pay-api-check
make bft-pay-action-check
```

`ynx-payd` requires merchant ID, public API key, and webhook signing key from its dedicated `0600` env file. Keep `YNX_PAY_GATEWAY_UPSTREAM_MODE=authoritative` for the current rollback-compatible public runtime; this mode also requires the separate chain-upstream key. Candidate `bft` mode requires chain ID, the canonical signer address, and exactly one process-local raw key source, preferably a mode-`0600` key file. It serializes idempotency query, nonce selection, signing, and broadcast; computes webhook HMAC locally with the separate webhook key; and rejects inconsistent commit or Pay record evidence. `make bft-pay-action-check` covers the signed BFT mutation path locally; it does not authorize public routing.

Trust Gateway readiness:

```bash
make trust-api-check
make bft-trust-action-check
```

`ynx-trustd` requires a client API key from its dedicated `0600` env file. Keep `YNX_TRUST_GATEWAY_UPSTREAM_MODE=authoritative` for the current rollback-compatible public runtime; this mode also requires the separate chain-upstream key and covers the full Trust surface. Candidate `bft` mode requires chain ID, a canonical signer address, and exactly one process-local raw key source, preferably a mode-`0600` key file. It signs governance request/review/reject, advisory label, evidence packet, tracking review, and Trust appeal/resolve mutations, serializes nonce selection, injects the configured signer for actor fields, and verifies committed records. Evidence bodies and signer secrets remain process-local; consensus stores bounded references, hashes, classifications, and audit metadata. `make bft-trust-action-check` covers the signed implementation, and fresh remote four-application/four-signer proof plus rollback supports capability promotion. Public routing remains forbidden until the separate full cutover gate, production signer custody/recovery, and authenticated public proof all pass.

Resource Gateway readiness:

```bash
make resource-api-check
make bft-resource-action-check
```

`ynx-resourced` requires a client API key from its dedicated `0600` env file. Keep `YNX_RESOURCE_GATEWAY_UPSTREAM_MODE=authoritative` for the current rollback-compatible public runtime; this mode also requires the separate chain-upstream key. Candidate `bft` mode requires chain ID `6423`, `YNX_RESOURCE_GATEWAY_SIGNER_ADDRESS`, and exactly one of `YNX_RESOURCE_GATEWAY_SIGNER_PRIVATE_KEY` or `YNX_RESOURCE_GATEWAY_SIGNER_PRIVATE_KEY_FILE`; use the mode-`0600` file option for candidate work and remove runtime material after rollback. BFT mutations require `idempotencyKey`, inject the configured signer, serialize nonce selection, obtain the committed policy/quote, and verify committed response evidence. It serves health/metrics and authenticated Resource Market routes on `YNX_RESOURCE_GATEWAY_HTTP_ADDR`, enforces request IDs, a 1 MiB request-body limit, a 2 MiB response limit, per-key/IP rate limits, and redacted fail-closed JSONL audit. The complete Resource path passed temporary remote four-application/four-signer proof and rollback; public routing remains authoritative until a separate full cutover decision and production custody/recovery review.

Bridge coordinator readiness:

```bash
make bridge-api-check
GOMAXPROCS=2 make deploy-dry-run
```

`ynx-bridged` requires a dedicated API key, at least two distinct base64 Ed25519 relayer public keys, a threshold of at least two, and one or more external-submission-disabled route policies. Keep `YNX_BRIDGE_DEPLOY_ENABLED=false` in a real deployment env until relayer custody and route approval are independently completed. The release package always carries the binary, dedicated env contract, systemd unit, state/backup paths, config check, and optional health check, but the deploy script installs and starts it only when that gate is explicitly `true`. The service persists local transfer, idempotency, attestation, finalization, and audit state under `/var/lib/ynx-chain/bridge` and rejects invalid/tampered state at startup. Its finalization is coordinator-local only: do not expose ingress or describe it as a live bridge until a separately reviewed external-chain adapter, mint/burn authority, custody, remote deployment, and public proof exist.

Stablecoin Issuer Control readiness:

```bash
make stablecoin-issuer-check
GOMAXPROCS=2 make deploy-dry-run
```

`ynx-stablecoind` requires `YNX_STABLECOIN_API_KEY`, `YNX_STABLECOIN_HTTP_ADDR`, and a writable `YNX_STABLECOIN_STATE_PATH`. The release package fixes the state path to `/var/lib/ynx-chain/stablecoin/state.json`, protects it with the shared mutation-freeze marker, and installs a loopback-only systemd service only when `YNX_STABLECOIN_DEPLOY_ENABLED=true`. Keep that gate `false` in the real deployment environment until an external issuer, independent legal/custody review, operator access policy, backup/rollback exercise, and explicit deployment approval exist. There is no public ingress configuration.

The daemon records issuer and asset governance lifecycle plus bounded mint/burn intents; it cannot execute token actions. Before any future deployment, use a unique operator API key, preserve the mode-`0600` state and env files, run `--check-config`, confirm health reports `issuerSupportEstablished=false` and `externalExecutionEnabled=false`, and verify backup restoration on a non-production copy. A locally approved candidate is not issuer support, legal approval, reserve proof, or authorization to mint/burn.

Emergency process: stop public writes, preserve logs, snapshot state, communicate incident, roll back only from verified backups.
