# Fable5 total acceptance audit

This audit covers all 36 numbered product sections in the founder specification. It replaces the older 23-product snapshot as the current inventory entry point; it does not rewrite or erase historical evidence.

## Authoritative inputs

- Founder specification: `/Users/huangjiahao/Downloads/YNX_Chain_Fable5_Coordinated_Ultimate_Goal_Prompts.md`
- Generated evidence: `release/integration/fable5-total-acceptance-audit.json`
- Reproducible auditor: `scripts/audit-fable5-products.mjs`

Run:

```sh
node scripts/audit-fable5-products.mjs \
  /Users/huangjiahao/Downloads/YNX_Chain_Fable5_Coordinated_Ultimate_Goal_Prompts.md \
  release/integration/fable5-total-acceptance-audit.json
```

## Strict interpretation

- A registered worktree proves only that a recoverable product workspace exists.
- A clean worktree proves only that no uncommitted file change was detected at audit time.
- A release record is current only when its source commit equals HEAD, or is an ancestor followed exclusively by evidence/metadata commits; any later runtime change invalidates the binding.
- Nine release booleans remain independent: local implementation, local tests, local installation, central integration, staging deployment, public deployment, hosted downloads, production signing, and store release.
- Even all nine booleans do not prove completion without direct runtime, installation, artifact and external acceptance evidence.
- A missing, stale, invalid or non-HEAD-bound record leaves the product `not-proven-complete`.

The generated report deliberately reports zero proven-complete products until the final controller independently verifies every product-specific Fable5 requirement. This prevents partial products, old builds, test-only artifacts and public HTTP shells from being counted as finished.

## Current recovery snapshot

The 2026-08-14 audit found:

| Signal | Result |
|---|---:|
| Fable5 product sections | 36 |
| Expected worktrees present | 36 |
| Clean after excluding the auditor's own output files | 29 |
| Branches still using the exact original prompt branch name | 15 |
| Products with at least one release record bound to their current runtime source | 5 |
| Products independently proven complete | 0 |

Branch-name mismatch is not treated as data loss because several worktrees have newer continuation branches. It is a recovery-review signal: Integration must inspect ancestry and handoff evidence instead of resetting a worktree to the older prompt branch. The seven dirty product worktrees are also preserved as active work and must not be overwritten. YNX Developer is currently dirty on a newer continuation source while its public release record remains bound to older runtime source `17ee9ae5`; neither the new commits nor the in-progress files are counted as current public release proof.

## Parallel ownership

- Calendar remains owned by worktree `36-calendar`.
- Wallet/Auth work is consumed through its versioned contract and is not duplicated by Integration.
- Financial products remain owned by Exchange, Quant, Finance and DEX worktrees; Integration freezes shared contracts and executes cross-product acceptance.
- Shared Website, Chain, Oracle, Bridge, Data Fabric, Security/SRE and Governance facts must have one authoritative owner and version.

## Next evidence pass

For each product, inspect the exact HEAD-bound release record and then verify its Fable5 product-specific flow against current source, public runtime, hosted artifacts, cold-start behavior, restart/recovery, concurrency, localization and ComputerControl evidence. Results must be added incrementally; absence of contradiction is not acceptance.
