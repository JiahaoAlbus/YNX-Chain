# YNX 6423 portal release handoff

## Candidate source identity

- Branch: `codex/ynx-6423-portal-tronscan-inspired`
- Candidate source commit: `6d9af9c42127930d89b07d037bfc66ed6628b7c8`
- Candidate-record commit: `6ede450c997e53c0fe06e3c24d1c114e8ba06c7c`
- Candidate source tree: `0b7f4052dbbdb4a943355644faa45b6a59b3b560`
- Scope: `internal/explorer`, `cmd/ynx-explorerd`, the portal evidence in `design-qa.md`, and `release/evidence/explorer-portal-source-candidate-2026-08-31.json`.
- Required official logo: `internal/explorer/assets/ynx-logo.png`
- Logo SHA-256: `38196080c2d56746fb37094abe68d1d89eabd8a2b29ab4f17bae48ac7e3effde`

## Verified local evidence

- `go test ./internal/explorer ./internal/indexer` passes at the candidate source.
- `make static-check` passes, including Go vet, shell and browser-script syntax, five-locale i18n coverage, and in-portal link integrity.
- `make explorer-check` passes against an isolated local 6423 node/indexer pair; it exercises the served API, identity, and portal shell without a public endpoint.
- `make explorer-portal-candidate-check` verifies the candidate-record commit against the pushed candidate source, source tree, and tracked SHA-256 values.
- The Explorer test rejects retired identity strings (`9102`, `0x238e`, and `ynx_9102-1`), loopback/private wallet publication URLs, blank/new-tab portal routes, and an incorrect logo byte stream.
- Local browser QA in `design-qa.md` covers desktop, tablet, 390 px mobile, a 320 px narrow layout, same-tab Blockchain navigation, token search/details, locale persistence, and zero error-level console messages. The current candidate also rejects the former 320 px body-width floor in its Explorer test, so narrow windows are not artificially widened before the next browser sweep. The latest responsive sweep keeps visible text at 11 px or larger and does not produce horizontal overflow in the tested widths.
- The local runtime is connected to the local 6423 node and indexer only; current health data identifies `6423`, `0x1917`, and `YNXT`. Wallet publication fields stay empty because no verified public HTTPS RPC/explorer pair has been supplied.
- A fresh temporary Indexer database and Explorer cold start were also checked twice with synchronized advancing 6423 RPC/indexed heights; the preceding unavailable Indexer produced the expected fail-closed portal response.

## Non-claims and release gate

This source handoff is **not** a public deployment, a public RPC claim, a wallet-network publication, a signed release, or a downloadable-product release. Do not enable any Wallet Add Network control, product Open/Download link, or artifact button until all of the following are independently verified against the exact deployed source:

1. Public HTTPS RPC and Explorer endpoints return the 6423 / `0x1917` / YNXT identity and are bound to this candidate or a separately recorded immutable release.
2. Each enabled ecosystem or download item has a public URL, file digest, signature status, release source, timestamp, and rollback target.
3. Browser checks reproduce the local route, responsive, locale, console, and fail-closed results against the deployed runtime.
4. A deployment owner supplies a one-run release lease covering the exact source, endpoint set, executor, and rollback action.

## Rollback

No deployment action is authorized by this handoff. The source rollback baseline recorded with this candidate is `c3510e208ad9e421c3a0b590bb3af7732ae8d6cb`; it is source evidence only and does not authorize a runtime, DNS, Caddy, Vercel, or alias mutation. If a future authorized release fails identity, asset-hash, route, or fail-closed checks, restore the previously verified immutable deployment alias rather than mutating DNS or a live alias ad hoc; record the rollback source identity and browser/API evidence alongside that action.
