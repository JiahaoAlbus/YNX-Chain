# YNX Bridge Current Plan

Status: ACTIVE  
Phase: TESTNET  
Branch: `codex/final-bridge`  
Verified source commit: `a1c640e00cc06924244834e2f2a77d18849aa834`  
Updated: 2026-07-27T14:43:56Z

## Verified baseline

- Workspace and branch match the designated YNX 21 worktree.
- Local and upstream commits are synchronized at `a1c640e00cc06924244834e2f2a77d18849aa834` before this evidence update.
- Canonical App Gateway integration and read-only staging deployment exist.
- Schema v1-v6 migration, tamper rejection, and deterministic v6 backup rollback/forward recovery pass under the Race detector.
- Public reads remain truthful and mutation routes remain disabled.
- Real YNX-supported route execution, verified contracts, signer ceremony, funding, deposit, and withdrawal evidence do not exist.
- The official Circle Sandbox probe timed out twice during the current recovery run; the provider gate failed closed.

## Immediate execution order

1. Remove status drift from Bridge readiness, release, public metadata, integration, and evidence records without overstating execution support.
2. Add Bridge-specific CI for unit, race, build, SDK, migration, restore, security, evidence, and artifact gates.
3. Produce reproducible unsigned/testnet-candidate server and SDK artifacts with SBOM, provenance, SHA-256, bytes, install, and cold-start evidence.
4. Re-run staging deployment, migration rollback, restore, and public probes against the current source commit when deployment access is available.
5. Obtain central consumer acceptance receipts for Wallet, Explorer, Monitor, and Trust vectors.
6. Keep source submission and destination execution disabled until an approved YNX-supported route, verified contracts, secure signer path, funding, and deployment authority all have direct evidence.

## Completion guard

A checkpoint commit or successful local test is not product completion. The product remains ACTIVE until every applicable coverage item is `verifiedComplete`, or the only remaining items are irreducible external inputs recorded in a minimized operator request.
