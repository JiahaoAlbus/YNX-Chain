# YNX 6423 portal release handoff

## Candidate source identity

- Branch: `codex/ynx-6423-portal-tronscan-inspired`
- Commit: `64dfcfdadbf5f4a643afc978a70b720d7885680f`
- Scope: `internal/explorer`, `cmd/ynx-explorerd`, and the portal evidence in `design-qa.md`.
- Required official logo: `internal/explorer/assets/ynx-logo.png`
- Logo SHA-256: `38196080c2d56746fb37094abe68d1d89eabd8a2b29ab4f17bae48ac7e3effde`

## Verified local evidence

- `go test ./internal/explorer ./internal/indexer` passes at the candidate source.
- Front-end script extraction passes `node --check`.
- The Explorer test rejects retired identity strings (`9102`, `0x238e`, and `ynx_9102-1`), loopback/private wallet publication URLs, blank/new-tab portal routes, and an incorrect logo byte stream.
- Local browser QA in `design-qa.md` covers desktop, 1024 px tablet, 390 px mobile, same-tab Blockchain navigation, token search/details, locale persistence, and zero error-level console messages.
- The local runtime was connected to the local 6423 node and indexer only; it returned `6423`, `0x1917`, and `YNXT`. The wallet publication fields stayed empty because no verified public HTTPS RPC/explorer pair was supplied.

## Non-claims and release gate

This source handoff is **not** a public deployment, a public RPC claim, a wallet-network publication, a signed release, or a downloadable-product release. Do not enable any Wallet Add Network control, product Open/Download link, or artifact button until all of the following are independently verified against the exact deployed source:

1. Public HTTPS RPC and Explorer endpoints return the 6423 / `0x1917` / YNXT identity and are bound to this candidate or a separately recorded immutable release.
2. Each enabled ecosystem or download item has a public URL, file digest, signature status, release source, timestamp, and rollback target.
3. Browser checks reproduce the local route, responsive, locale, console, and fail-closed results against the deployed runtime.
4. A deployment owner supplies a one-run release lease covering the exact source, endpoint set, executor, and rollback action.

## Rollback

No deployment action is authorized by this handoff. If a future authorized release fails identity, asset-hash, route, or fail-closed checks, restore the previously verified immutable deployment alias rather than mutating DNS or a live alias ad hoc; record the rollback source identity and browser/API evidence alongside that action.
