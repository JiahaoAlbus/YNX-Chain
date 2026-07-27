# YNX Bridge Current Plan

Status: ACTIVE  
Phase: TESTNET  
Branch: `codex/final-bridge`  
Verified source commit: `3060deee4132bcd6bdc0d9284e0291391fa3bc4e`  
Updated: 2026-07-27T15:19:57Z

## Verified baseline

- Workspace and branch match the designated YNX 21 worktree.
- Local and upstream commits were synchronized at `3060deee4132bcd6bdc0d9284e0291391fa3bc4e` before this evidence update.
- Canonical App Gateway integration and the historical read-only staging/public-read deployment exist.
- Schema v1-v6 migration, tamper rejection, deterministic v6 backup rollback/forward recovery, and bounded local restore pass.
- GitHub Actions Bridge run `30278915644` passed pinned contract generation, placeholder/secret gates, Bridge Race, full repository tests, SDK/integration, migration/capacity/restore/evidence, and reproducible supply-chain checks.
- Verification artifact `8657978658` exists and is source-SHA-bound; it is not a publishable Bridge release artifact, and its archive could not be independently unpacked because Blob TLS handshakes timed out twice.
- Public reads remain available, while source submission, destination execution, and user asset movement remain disabled.
- Public product metadata now distinguishes the runtime status endpoint from a public status page and requires explicit `destination_available` plus `destinationAssetAvailable=true` before asset availability.
- Real YNX-supported route execution, verified contracts, signer ceremony, funding, deposit, and withdrawal evidence do not exist.
- `npm ci` reports 3 High advisories; exact advisory identities remain unresolved because `npm audit --json` timed out.

## Immediate execution order

1. Protect the CI and public-metadata truth update.
2. Resolve the npm High advisory identities and remediate or document a bounded, expiring suppression.
3. Produce reproducible unsigned/testnet-candidate server and SDK archives with SBOM, provenance, SHA-256, bytes, minimum OS, install, and cold-start evidence.
4. Add candidate artifact publication to GitHub Actions and create a Bridge prerelease without claiming production signing.
5. Download and verify release bytes, installation, cold start, and artifact provenance.
6. Re-run staging deployment, migration rollback, restore, and public probes against the latest verified runtime source when deployment access is available.
7. Obtain central consumer acceptance receipts for Wallet, Explorer, Monitor, and Trust vectors.
8. Keep source submission and destination execution disabled until an approved YNX-supported route, verified contracts, secure signer path, funding, and deployment authority all have direct evidence.

## Completion guard

A green CI run, verification artifact, checkpoint commit, public read endpoint, or candidate prerelease is not product completion. The product remains ACTIVE until every applicable coverage item is `verifiedComplete`, or the only remaining items are irreducible external inputs recorded in a minimized operator request.
