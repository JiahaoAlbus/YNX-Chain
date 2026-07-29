# YNX 18 Integration Handoff

| Field | Value |
| --- | --- |
| Product | YNX Whitepaper / Compliance / Brand |
| Product slug | `docs-compliance-brand` |
| Contract | `release/integration/docs-compliance-brand-contract.json` |
| Contract version | `0.1.1-candidate` |
| Source baseline | `e36832d5be0c498d8a2f27869f8d70fc112e9442` |
| Release | `0.2.0-candidate` |
| Current phase | PUBLIC |
| Goal status | Active |

## Consumer rule

Website, Gateway, Explorer, Monitor, Integration and product owners may consume only
the bounded fact, claims, locale, metadata and release records named by the contract.
Consumers must not reinterpret a Candidate, Testnet, local, staging, public, hosted,
signed or store state as a stronger state.

## Acceptance sequence

1. Validate `release/integration/docs-compliance-brand-contract.json` and
   `.ai-bridge/full-goal-coverage.json`.
2. Run `make full-goal-coverage-check`, `make public-disclosure-check` and
   `make docs-compliance-check` from the exact source tree.
3. Pin the accepted source commit and contract version.
4. Preserve `source`, `asOf`, `version`, evidence identity, state class and failure
   semantics when rendering or redistributing a record.
5. Reject missing evidence, unknown required fields, stale supersession links and any
   wording stronger than the contract permits.

## Current accepted public boundary

The Website has accepted and publicly rendered the documentation authority package,
and an immutable unsigned candidate archive is hosted. Production signing, store
release, named legal/economic/security approval and independent public proof are not
established. The exact Website and archive evidence remains in
`release/evidence/website-public-acceptance-2026-07-26.json`.

## Newer integration candidate

Source `e36832d5be0c498d8a2f27869f8d70fc112e9442` validates fourteen high-authority
documents and adds the staking, liquid-staking and Safety Module disclosure to the
required Website-content package. GitHub Actions run `30416936231` succeeded and artifact
`8710484610` is unexpired through 2026-08-28. The deterministic package is
`ynx-website-content-e36832d5be0c.zip`, 277,277 bytes, SHA-256
`87b3cb20ddbe3d7e879a751c791b3fc90cb0b01face5d17fcad3c8da23d4f420`.

This newer candidate is not Website-accepted, publicly hosted or production signed.
Consumers must preserve the release states of the accepted package separately from the
candidate states recorded in `release/integration/docs-compliance-brand-contract.json`.
YNX 29 must resolve compatibility and merge order because this product branch is nine
commits ahead of and 47 commits behind `origin/main`; YNX 18 must not perform an
unreviewed broad merge that could overwrite other products.

## Owner handoff boundary

YNX 18 does not copy dirty or local-ahead sibling work into public authority records.
Each owner must supply a clean exact commit, focused tests, state booleans, evidence
paths, allowed and forbidden wording, expiry and dependencies. Missing owner evidence
keeps the affected claim in Candidate, Goal or Blocked state.

## Change and rollback

Any incompatible change increments `contractVersion`, records a migration decision and
preserves superseded facts. Rollback restores the last accepted immutable bundle while
retaining the correction or incident record; it must not silently revive a withdrawn
claim.
