# YNX Bridge Current Plan

Status: ACTIVE  
Phase: TESTNET  
Branch: `codex/final-bridge`  
Runtime source commit: `0c628599c6c80cb244ddeb2e92861eb530c4cecb`  
Updated: 2026-07-27T14:22:23Z

## Verified baseline

- Workspace and branch match the designated YNX 21 worktree.
- Local and upstream runtime commit are synchronized at `0c628599c6c80cb244ddeb2e92861eb530c4cecb`.
- Canonical App Gateway integration and read-only staging deployment exist.
- Public reads remain truthful and mutation routes remain disabled.
- Real YNX-supported route execution, verified contracts, signer ceremony, funding, deposit, and withdrawal evidence do not exist.
- The official Circle Sandbox probe timed out twice during the current recovery run; the provider gate failed closed.

## Immediate execution order

1. Validate and protect the `.ai-bridge` recovery and full-goal coverage package.
2. Remove status drift from Bridge readiness, release, public metadata, integration, and evidence records without overstating execution support.
3. Implement and test a loss-aware rollback/forward-recovery rehearsal for the current persistent state schema.
4. Add Bridge-specific CI for unit, race, build, SDK, migration, restore, security, evidence, and artifact gates.
5. Produce reproducible unsigned/testnet-candidate server and SDK artifacts with SBOM, provenance, SHA-256, bytes, install, and cold-start evidence.
6. Re-run staging deployment and public probes against the current source commit when deployment access is available.
7. Obtain central consumer acceptance receipts for Wallet, Explorer, Monitor, and Trust vectors.
8. Keep source submission and destination execution disabled until an approved YNX-supported route, verified contracts, secure signer path, funding, and deployment authority all have direct evidence.

## Completion guard

A checkpoint commit or successful local test is not product completion. The product remains ACTIVE until every applicable coverage item is `verifiedComplete`, or the only remaining items are irreducible external inputs recorded in a minimized operator request.
