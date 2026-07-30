# YNX Oracle & Market Data — Active Handoff

**Branch:** `codex/final-oracle-market-data`  
**Lifecycle:** Protected source candidate — central acceptance pending
**Authority:** YNX Oracle & Market Data owns canonical price and market-data facts for downstream products.

## Verified local baseline

- The Go runtime contains signed observation validation, replay protection, provider registry loading, normalized and aggregate persistence, correction events, historical replay, circuit breaking, and fail-closed quality states.
- Public runtime endpoints include `/health`, `/version`, `/prices`, `/markets`, `/providers`, `/status`, `/history`, `/corrections`, and a sanitized `/metrics` response.
- Internal Prometheus metrics remain separated from the public HTTP surface.
- The targeted race suite for `internal/oracle`, `internal/oracle/providers`, and `sdk/oracle/go` passes locally.

## Current truth

Frozen source commit: `7ba44cfbe66455884ac6c2ea8525e9738b7f1396`.

The long-term goal is not complete. The following release states remain false until direct evidence exists:

- `integratedCentral`
- `downloadHosted`
- `productionSigned`
- `storeReleased`

No approved provider is active for `YNXT/YUSD_TEST`, and no consumer-owner Oracle acceptance evidence has been returned. The verified public Testnet API therefore remains degraded at 0/3 sources and publishes no authoritative prices. The owner-only Oracle Web does not count as public.

## Immediate continuation

1. Protect and publish the exact source-only candidate with immutable hashes, SBOM and provenance.
2. Obtain exact-head CI and branch-protection evidence.
3. Merge the candidate into 29 Integration and record a central acceptance receipt.
4. Keep provider activation, consumer receipts, shared Testnet and public authoritative publication as separate fail-closed gates.

## External inputs that may eventually block activation

Provider credentials, redistribution rights, reporter signer custody, Governance approval, central consumer contracts, public deployment authority, DNS, and stablecoin attestation providers must be supplied through secure operator workflows. Secrets must never be pasted into chat or committed to the repository.
