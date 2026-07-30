# Dependency Acceptance

Authority: `29-integration`  
Source baseline: `05652b201acf830495a8fb2fba5416e5f4ea9d8c`
Current gate: `INTEGRATE`

This record defines the central dependency acceptance boundary. Product-owner branches remain candidate inputs until the exact source commit and its evidence are reviewed by the named authority owner and by Integration. A branch, CI run, artifact, public page or local smoke result cannot promote another product by implication.

## Authoritative dependency owners

| Authority | Owner | Required acceptance evidence | Current central state |
| --- | --- | --- | --- |
| Network identity, consensus, chain events | 01 Chain Core | versioned network identity; four-node BFT evidence; replay/fault/restart/rollback evidence; public endpoint class | Centrally source-accepted at `324f376dac2db434673ccec2c6d212ed3d23f79e` through merge `329092c19794ee376248750c2b138090e8418e08`; shared-Testnet/public gates remain separate |
| Wallet identity, Product Session, Mandate, Revoke | 02 Wallet/Auth | canonical tuple and digest; device challenge; introspection; expiry/revoke; replay/tamper/wrong-scope vectors | Centrally source-accepted at `f28b0aa29a0d93a2b7f20a00b835c4a1aa6175b3` through merge `94acfeced03f5fcb829b06b7fce0dce8dacb4f11`; shared-Testnet/public gates remain separate |
| Oracle and market data | 19 Oracle | provider register; source/as-of/version/coverage; stale/outage behavior; license and rate-limit evidence | Centrally source-accepted at `a059d573ed128a704ec447561711a13cb1e3d9dd` through merge `d364f9950c1f43fe84b046ec88b1978b9a4749e4`; provider-bound shared-Testnet/public gates remain separate |
| Bridge asset lifecycle | 21 Bridge | canonical asset states; exposure limits; wrong-chain/replay controls; emergency exit and recovery | Pending branch scan and owner contract review |
| Canonical events and billing ledger | 26 Data Fabric | event schema; idempotency; ordering; migration; reconciliation; retention/export/delete | Centrally source-accepted at `2a09d7455a5fef9eee56ca736be4b600d40a1831` through merge `01131b469dc8b1ae0a52e68583ccf4fba38a825e`; shared-Testnet/public gates remain separate |
| Unique Quant Engine | 08 Quant Lab | one engine identity; Exchange/DEX/Paper adapters; independent risk engine; mandate enforcement; no-withdraw/private-key boundary | Pending branch scan and owner contract review |
| Economics and parameter registry | 17 Tokenomics | fee authority; reserve/redemption; treasury and safety module; high-water-mark rules; no fee on unrealized PnL | Centrally source-accepted at `7c540b7f3f5872adbd8f65e4c8975eeac41c3a3f` through merge `05652b201acf830495a8fb2fba5416e5f4ea9d8c`; shared-Testnet Chain/Explorer/Monitor/Data Fabric attestations and public gates remain separate |
| Governance and timelock | 31 Governance | proposal/vote/timelock/canary/rollback; emergency scope; audit and duplicate-execution rejection | Centrally source-accepted at `7c3c952eade20041bc616616fbfc0cba020717e4` through merge `b656692622cde1fba47c8068399f0d83385de4cf`; shared-Testnet/public gates remain separate |
| Security, release, backup, artifact policy | 30 Security/SRE | Threat Model; secret/SAST/DAST/dependency/license scans; SBOM/provenance; restore drill; incident and alert evidence | Centrally source-accepted at `e670749b83a1b40d09ed717eb3515d539c005c49` through Integration merge `a472d588b4f037c57db6d7941b1b37572f91d114`; shared-Testnet and production/public gates remain separate |
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

Seven source acceptances are complete and machine-bound to exact owner SHAs,
Integration merge ancestry, exact-head CI and central test receipts. Product 21
Bridge remains the missing Phase 0 authority. These decisions do not prove
shared Testnet, provider-bound monitoring, staging, public runtime, immutable
hosting, production signing, store release or Mainnet. Those promotions remain
fail-closed.
