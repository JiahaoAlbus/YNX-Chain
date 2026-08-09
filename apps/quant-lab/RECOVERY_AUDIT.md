# Quant Lab recovery audit

Audit date: 2026-07-22

## Recovered baseline

The designated Quant worktree was absent. It was recreated from commit
`22604af0717a19b5f8aa9223685c3ad3f049941a`, the newest commit found with
Quant Lab implementation history. The source was the Exchange product branch;
the recovered Quant files are now owned by the dedicated Quant branch and
worktree.

Recovered implementation:

- Go research, backtest, paper, risk-kill, mandate, and bounded-testnet service
- HTTP API and responsive web UI
- twelve locale catalogs, including Arabic RTL
- engine evaluation, dependency review, notices, SBOM, UI audit, release notes,
  and central integration records
- unit, HTTP, UI-contract, and browser tests

The Exchange worktree contained an untracked `product-release.json`. It was not
copied because it contains an implementation-commit placeholder, an obsolete
branch name, and claims that must be regenerated from current evidence.

## Baseline verification

| Check | Result |
| --- | --- |
| `go test ./internal/quantlab ./apps/quant-lab/server` | pass |
| `npm test --prefix apps/quant-lab` | pass |
| `npm run test:browser --prefix apps/quant-lab` | pass after removing a hard-coded dependency on the Exchange worktree |

The browser test produced direct local evidence for desktop light/dark, Arabic
RTL mobile layout, honest missing-market-data failure, paper reconciliation,
and the kill switch. This evidence proves local preview behavior only.

## Release truth at recovery

| State | Value | Evidence |
| --- | --- | --- |
| `implementedLocal` | true | recovered source and routes |
| `testedLocal` | true | baseline commands above |
| `installedLocal` | false | no installed desktop or packaged server proof |
| `integratedCentral` | false | integration records are pending handoff only |
| `deployedStaging` | false | no staging deployment evidence |
| `deployedPublic` | false | no public endpoint evidence |
| `downloadHosted` | false | no immutable hosted artifact |
| `productionSigned` | false | no production signing evidence |
| `storeReleased` | false | no store release evidence |

## Material gaps against the delivery objective

The baseline is not a complete Quant Engine delivery. Required work still
includes:

- split `ynx-quantd`, worker, paper, risk, web, and CLI services
- canonical Wallet/Auth/Gateway verification, revocation, replay and tamper
  coverage, and real Exchange/DEX adapters
- complete lifecycle enforcement from Draft through Archived
- dataset catalog, lineage, license, correction, bias, and retention controls
- signed and sandboxed strategy packages with resource and network limits
- REST completion, WebSocket, Python SDK, TypeScript SDK, CLI, templates, Docker
  Compose, Kubernetes candidate, macOS and Windows desktop packages
- observability, migration/rollback, backup/restore, capacity, economics,
  threat model, security scans, provenance, and public-product metadata
- actual bounded Exchange and DEX Testnet transactions and cross-product
  Explorer, Finance, Monitor, and Trust evidence
- public deployment and hosted downloadable artifacts

No missing item above may be inferred from this recovery audit or from passing
local preview tests.
