# YNX Trust Center Decision Log

## 2026-07-29 — Separate module verification from offline compilation

Decision: `go mod verify` uses a network-capable verification environment when the inherited proxy settings are absent or explicitly `off`; release compilation remains offline and deterministic.

Rationale: `go mod verify` validates the downloaded module cache against `go.sum`. A fresh CI runner may not have every transitive module cached, so forcing `GOPROXY=off` made verification dependent on cache luck. Allowing resolution before verification does not relax the later offline build boundary.

Evidence: fix commit `1baeccada8e72eab8277803973d0e598dcf19b51`; successful GitHub Actions run `30416831778`.

## 2026-07-29 — Publish a prerelease, not a production release

Decision: publish `trust-center-v0.1.0-testnet-preview.1` as a GitHub prerelease with the signing class `unsigned-local`.

Rationale: CI proves reproducibility, integrity, vulnerability/license checks and clean installation, but no production signing, notarization, central integration, public deployment or independent production attestation exists.

Evidence: archive SHA-256 `92805078f0a8daebc1e329a293e625d161b600c70371d4cfb7a2ed57e47d1850`; release source commit `1baeccada8e72eab8277803973d0e598dcf19b51`.

## 2026-07-29 — Set only evidence-backed release booleans

Decision: promote `installedLocal=true` and `downloadHosted=true`; retain `integratedCentral=false`, `deployedStaging=false`, `deployedPublic=false`, `productionSigned=false` and `storeReleased=false`.

Rationale: each state is independent. A hosted artifact is not a deployed service, and a successful product workflow is not shared-Testnet integration or production signing.

Evidence: `product-release.json`, `public-product-metadata.json`, `FEATURE_COMPLETION_EVIDENCE.md`.

## 2026-07-29 — Keep ynxweb4.com as the only product canonical

Decision: all product Website, SEO, canonical, public evidence and download handoff references use `https://ynxweb4.com/trust-center`.

Rationale: `huangjeo.com` is the Founder website, not the YNX product domain. Legitimate `mcpXX.huangjeo.com` service endpoints are a separate infrastructure namespace and must not be rewritten.

Evidence: `docs/handoffs/trust-center-website.md`, `public-product-metadata.json`; repository audit found no `huangjeo.com` product-domain misuse.

## 2026-07-29 — Do not implement destructive lifecycle without policy

Decision: subject export remains complete, but deletion and retention remain blocked until the canonical legal/privacy policy is frozen.

Rationale: inventing retention durations or audit-preservation exceptions would create irreversible compliance semantics outside product-15 authority.

Evidence: `docs/agent-memory/BLOCKERS.md`, `.ai-bridge/full-goal-coverage.json` entry `TRUST-DATA-001`.

## 2026-07-29 — Preserve branch divergence for central integration

Decision: do not rebase, reset, force-push or merge `origin/main` during this product slice.

Rationale: the Trust branch is 14 commits ahead and 78 commits behind `origin/main`. Central integration requires semantic reconciliation across product owners, not an unreviewed history rewrite that could discard newer central work or Trust evidence.

Evidence: `git rev-list --left-right --count origin/main...HEAD` returned `78 14` at checkpoint `a8383e12`.
