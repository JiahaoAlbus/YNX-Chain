# Dependency Acceptance

Authority: `29-integration`  
Source baseline: `3ee6477d82ecffea954387ce88135793bddb1271`
Current gate: `INTEGRATE`

This record defines the central dependency acceptance boundary. Product-owner branches remain candidate inputs until the exact source commit and its evidence are reviewed by the named authority owner and by Integration. A branch, CI run, artifact, public page or local smoke result cannot promote another product by implication.

## Authoritative dependency owners

| Authority | Owner | Required acceptance evidence | Current central state |
| --- | --- | --- | --- |
| Network identity, consensus, chain events | 01 Chain Core | versioned network identity; four-node BFT evidence; replay/fault/restart/rollback evidence; public endpoint class | Pending branch scan and owner contract review |
| Wallet identity, Product Session, Mandate, Revoke | 02 Wallet/Auth | canonical tuple and digest; device challenge; introspection; expiry/revoke; replay/tamper/wrong-scope vectors | Pending branch scan and owner contract review |
| Oracle and market data | 19 Oracle | provider register; source/as-of/version/coverage; stale/outage behavior; license and rate-limit evidence | Pending branch scan and owner contract review |
| Bridge asset lifecycle | 21 Bridge | canonical asset states; exposure limits; wrong-chain/replay controls; emergency exit and recovery | Pending branch scan and owner contract review |
| Canonical events and billing ledger | 26 Data Fabric | event schema; idempotency; ordering; migration; reconciliation; retention/export/delete | Pending branch scan and owner contract review |
| Unique Quant Engine | 08 Quant Lab | one engine identity; Exchange/DEX/Paper adapters; independent risk engine; mandate enforcement; no-withdraw/private-key boundary | Pending branch scan and owner contract review |
| Economics and parameter registry | 17 Tokenomics | fee authority; reserve/redemption; treasury and safety module; high-water-mark rules; no fee on unrealized PnL | Pending branch scan and owner contract review |
| Governance and timelock | 31 Governance | proposal/vote/timelock/canary/rollback; emergency scope; audit and duplicate-execution rejection | Pending branch scan and owner contract review |
| Security, release, backup, artifact policy | 30 Security/SRE | Threat Model; secret/SAST/DAST/dependency/license scans; SBOM/provenance; restore drill; incident and alert evidence | Centrally source-accepted at `4277317bb4999ac4edfbc321590b54d95e1839f9` through Integration merge `3ee6477d82ecffea954387ce88135793bddb1271`; shared-Testnet and production/public gates remain separate |
| Website public registry and SEO | 28 Website | accepted metadata consumption; canonical route; runtime/public status separation; immutable download; public probes | Pending branch scan and owner contract review |
| Protocol freeze, merge order, shared Testnet, public proof | 29 Integration | 01–36 matrix; conflict resolution; dependency acceptance; cross-product vectors; exact accepted commits | In progress in this branch |

## Acceptance rules

1. The dependency source commit must be a reachable exact Git object on the declared final branch and must be synchronized with `origin`.
2. The registered product worktree must be clean at the acceptance observation. Dirty work remains protected but cannot be accepted.
3. A product release record, public metadata, full-goal coverage, integration contract, handoff, test vectors and dependency record must be present and source-bound.
4. Product-owner test claims are inputs, not central acceptance. Integration reruns the applicable contract, negative, migration, restore, security and artifact checks.
5. A dependency may remain `externalBlocked` only for a real signer, funding, DNS, provider, legal, store or audit input. Remaining autonomous work keeps the product active.
6. No product may define a second long-lived authority for Wallet/Auth, price, billing, Quant, release, economics, governance, network identity or public status.
7. Testnet, preview, simulator, unsigned and test-signed evidence retain their exact release class.

## Merge-order gate

Phase 0 authorities are reviewed first: 01, 17, 19, 21, 26, 30 and 31. Phase 1 depends on their accepted versions. Phase 2 and Phase 3 cannot pass central Testnet acceptance while a required Phase 0 authority is missing. Phase 4 public promotion remains blocked until product runtime state, Website state, artifact state and public proof are separately verified.

## Current boundary

Security/SRE source acceptance is complete and machine-bound to its exact owner
SHA, Integration merge ancestry, exact-head CI and central test receipt. It does
not accept the remaining Phase 0 authorities and does not prove shared Testnet,
provider-bound monitoring, staging, public runtime, immutable hosting,
production signing, store release or Mainnet. Those promotions remain
fail-closed.
