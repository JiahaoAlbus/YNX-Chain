# Next Action

## Current Integration priority (2026-07-28)

Current single action: integrate and re-verify the accepted product candidates on
the current `main` baseline, beginning with the Governance candidate now merged at
`340e6a8`, while keeping public deployment, production, Mainnet, audit and
third-party acceptance claims false until their required external evidence exists.

Why this is next:

- `main` is synchronized with `origin/main` at `340e6a8`; the Docs / Compliance
  authority layer and Governance `v0.3.0-integration` candidate are already
  preserved in repository history.
- Governance has a bounded local control plane, deterministic builds, a standalone
  read-only UI, central Chain Core / Comet execution adapters and a multiprocess
  four-validator lifecycle. These are integration-candidate facts, not public
  deployment proof.
- The repository had a Governance CI script but no matching root Make target.
  `make governance-check` is now the canonical local entrypoint, paired with
  `make governance-testnet-drill`; both are included in the central preflight.
- npm audit calls now use bounded fetch timeouts and no retry amplification so a
  broken registry path fails closed instead of hanging an integration run.
- Shared Testnet acceptance still needs exact Explorer, Monitor, Trust, Data
  Fabric, Security/SRE and central Integration evidence. Production custody,
  deployment destinations, independent review and owner-authorized external
  actions remain outside local engineering authority.

Required execution and proof:

- Run `make governance-check`, `make governance-testnet-drill` and the repository
  preflight from a clean, current baseline.
- Keep every release-state boolean evidence-bound. A local lifecycle, mock-free UI
  build or candidate tag must not be promoted to staging, public, production,
  Mainnet, audited or independently accepted.
- Replay each subsequently accepted product handoff against current `main`, resolve
  central contract conflicts once, and update the integration matrix with exact
  source commits and focused test evidence.
- Collect operator input only when the remaining step truly requires credentials,
  custody review, legal approval, external-provider capacity, DNS/hosting control
  or an explicitly approved remote mutation.

Completion standard:

- Current-main local gates pass and their exact source identity is recorded.
- Shared Testnet evidence covers the central dependencies without fabricated
  endpoints, transactions, availability or third-party acceptance.
- Remaining blockers are reduced to an exact, minimal external-input list before
  any public rollout or production claim.

## Current Docs / Compliance priority (2026-07-25)

Current single action: preserve and publish the verified 0.2.0 candidate authority layer on `codex/final-docs-compliance`, then collect exact owner handoffs for protected sibling-worktree changes before changing any public product, economic, security, deployment or availability claim.

Why this is next:

- The recovered package now has a 12-class authoritative fact index, local schemas, evidence and supersession records, nine evidence-linked Claims, 12 locale records, a conflict report and a fail-closed public disclosure gate.
- Public tags, releases and artifacts predate the current documentation work, and no current documentation-branch CI run, release or artifact was observed.
- Wallet/Auth, Tokenomics, Oracle, Bridge, Data Fabric and Security/SRE contain protected dirty work; Music and Quant contain local-ahead commits. None is an accepted public fact until its owner commits, tests and hands it off.
- Current endpoint observations are mixed and come through an ineligible workstation proxy path. The www site, App Gateway and Faucet returned HTTP 200, while the root site, Explorer and EVM RPC timed out. This proves neither portfolio-wide availability nor an outage.
- Mainnet launch, public StreamBFT activation, central integration, public deployment, immutable hosting, production signing, legal approval and independent audit remain false or blocked.

Files owned by this action:

- `release/facts`, `release/schemas`, `release/locales` and bounded `release/evidence`
- `scripts/verify/public-disclosure-gate.mjs` and the documentation compliance entrypoint
- Docs/Compliance recovery, integration, acceptance, brand and release records
- a dedicated Docs/Compliance CI or release handoff, without modifying sibling product implementations

Required execution and proof:

- Run the public disclosure gate, integrated documentation compliance check, no-placeholder check, secret scan and objective-state check.
- Review the complete current-worktree diff and preserve every pre-existing recovery file.
- Commit only YNX 18-owned files and verify local/remote branch identity after push.
- Require each sibling owner handoff to include exact source commit, clean handoff state, focused tests, release-state booleans, evidence paths, allowed wording, forbidden wording, expiry and dependencies.
- Keep missing support, privacy, security-report and service-status URLs blocked until the Website/Operations owner supplies approved routes and deployment evidence.

Completion standard:

- The candidate fact package and both local gates pass from a clean committed branch.
- GitHub CI records the Docs/Compliance checks for the exact candidate commit.
- A release or immutable artifact, when created, includes digest, byte count and source identity and remains explicitly candidate and unsigned unless stronger evidence exists.
- Dirty or local-ahead owner work is not silently copied, deleted, reset or promoted.
- No Testnet observation is rewritten as Mainnet, production, legal approval, audit approval, guaranteed economic outcome or independent availability proof.

## Historical Chain Core action (2026-07-16)

Highest-priority bounded delivery (2026-07-16):

Current single action: preserve deployed release `02f4ccd8770c` and protected Prometheus, harden the now-layered direct public ingress diagnosis without weakening timeouts, and prove repeated zero-failure direct-route chain/API continuity from multiple non-primary regions. Restore provider-backed AI only after the external account can return a real successful response.

Why this is next:

- The public chain still depends on one producer and three authenticated read-only followers while the approval-gated BFT transition remains intentionally inactive.
- Current source now exposes the real replication lifecycle, `catchingUp`, freshness, exact source/local height and hash, lag, attempts, successes, failures, timestamps, bounded error evidence, Prometheus telemetry, alerts, and Grafana panels.
- Current source now also seals the complete authoritative snapshot as v2, durably syncs replacement, permits one marker-free v1 migration, rejects later downgrade/corruption, and restores in-memory state when replication persistence fails.
- Local lifecycle, degraded recovery, persisted-state restart, exact convergence, race, smoke, and verification checks pass. Prometheus 3.11.2 is now deployed on the primary's WireGuard address with four distinct targets; a controlled Seoul outage made the expected metrics-down alert pending, firing, and cleared after recovery.
- Authoritative snapshot-v2 runtime `02f4ccd8770c` is deployed on all four roles. Exact manifest/binary checks pass; every role has marker/version 2; all three followers passed fresh canonical convergence and read-only rejection; one Seoul restart proved lifecycle reset and authenticated recovery. The subsequent verifier race fix and bounded Explorer/AI waiting logic are local control-plane changes only and do not change the deployed chain runtime.
- Post-drill convergence passed for all followers, including restarted Seoul at height `200947`, and public RPC grew from `200969` to `200971`. Fresh direct path diagnosis found no Caddy restart, listener backlog, backend failure, host pressure, or local `:443` rate limit. Primary and Singapore direct cycles each passed 50/50 reads with block growth; Silicon Valley passed 49/50 before one RPC TLS timeout, then passed 20/20 TLS 1.2, 20/20 TLS 1.3, and 20/20 HTTPS RPC retries. The workstation is ineligible as a direct vantage because SingLinkVPN resolves YNX names into `198.18.0.0/15` and routes traffic through `utun4`. Provider-backed AI remains blocked by upstream HTTP `429`. None of this is independent proof.
- A later Singapore check also passed 5/5 REST transaction, 5/5 Explorer
  transaction, 5/5 EVM transaction, 5/5 successful EVM receipt, and 5/5 exact
  release reads for the committed Exchange reference while height grew `204647`
  to `204653`. Silicon Valley could not repeat this check because three strict
  SSH attempts timed out at the banner before any API request. Seoul then
  repeated all five groups 5/5 while height grew `215973` to `215988`, completing
  bounded operator-controlled continuity from two non-primary regions. The next
  ingress gap is an independent public vantage or redundant ingress plus
  resolution of the observed Silicon Valley path instability, not another
  Singapore or Seoul rerun.

Files to touch:

- ingress and reverse-proxy configuration, health checks, and bounded diagnostics
- `scripts/deploy`, `scripts/verify`
- API, operations, and acceptance documentation only after matching evidence exists

Required execution and proof:

- Preserve the four scoped predeploy backups and exact release/manifest/checksum evidence; do not rerun deployment while the current authoritative runtime remains healthy.
- Require each follower to continue reporting `status=synced`, `catchingUp=false`, `fresh=true`, exact source/local height and hash equality, and canonical agreement with the primary at that height.
- Preserve the protected four-target Prometheus service and require all targets to remain `up=1` during ingress work.
- Correlate direct-route failures with DNS, TLS, ingress/reverse-proxy, and backend health evidence; do not hide failures with larger timeouts or retries that exceed existing bounded policy.
- Prove repeated direct-route exact-release reads, block growth, and transaction/receipt continuity after the restart. Operator-routed Singapore evidence remains a diagnostic fallback, not direct or independent proof.
- If ingress or SSH remains unsafe, record the external blocker and continue local chain/BFT engineering without claiming remote proof.

Validation commands:

- `go test ./...`
- `go test -race ./internal/chain ./cmd/ynx-chaind`
- `make validator-peer-readiness-check`
- `make monitoring-check`
- `make replication-alert-check`
- `make deploy-source-integrity-check`
- `make verify-testnet-check`
- `make replication-compression-check`
- `make public-ingress-path-check`
- `make smoke-test`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `GOMAXPROCS=2 make preflight`
- `make objective-state-check`

Completion standard:

- Exact release identity and scoped backup evidence exist on all four authoritative roles.
- Every role has persisted a valid snapshot v2 and downgrade marker without losing the pre-upgrade backup.
- All followers expose fresh exact source/local equality, and one follower repeats it after a controlled restart.
- All three follower scrape targets remain protected and distinguishable after the completed observed-and-cleared interruption drill.
- Multiple bounded direct-ingress cycles pass exact-release reads, public chain growth, and transaction/receipt continuity without zero-status fetch failures.
- No BFT cutover, mainnet launch, exchange listing, issuer support, wallet default support, partnership, or independent proof is inferred.

Explicitly not doing:

- Do not execute any BFT freeze, signer installation, dependency transition, ingress cutover, or public rollback phase without the required external approval.
- Do not expand bounded EVM/IDE except to preserve passing tests.
- Do not merge product branches out of dependency order.
- Continue reviewing the 15 clean registered ecosystem worktrees against
  `docs/coordination/PRODUCT_ACCEPTANCE_MATRIX.md`; the original tasks own
  product rework, native/installable artifacts, and 12-language/RTL closure.
- Do not modify or replace the long-term goal file.
