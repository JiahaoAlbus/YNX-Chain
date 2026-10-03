# Quant observed-state disappearance guard

Predecessor `46afd71d3e67310f7cb5bed5625e9c600d262fe2`, tree `644e6cd50c5e31c09fda7b048d947134d1c3c8b8`; branch `codex/exchange-sso-cookie-binding-20261002`.

## Implemented

Previously reload returned success when a previously observed persistent workspace disappeared. Cached data could then be labelled authoritative and a new mutation could recreate the missing state from cache. Each running service now records whether it has successfully loaded or saved durable state. Thereafter missing storage returns ErrUnavailable. First-use empty workspace behavior is preserved; no persisted schema/identity/session/authority changed. PostgreSQL readiness now requires an actually found durable row, not merely an error-free query. Health ready does not overclaim a missing row.

Real file regression opens two service instances, creates a research record, renames only its isolated test file out of the way, then verifies: snapshot failure; Kill/reconciliation/research refuse with ErrUnavailable; cached state digest unchanged; health503; no authority file recreation. Restoring the exact original file recovers both services with the original digest and health200. A separate store-interface fixture proves absent multi-instance rows yield ready503 and health ready=false; that fixture is not a real PostgreSQL execution.

## Executed

- Focused real-file regression PASS, 0.865 s.
- Full `go test -race ./internal/quantlab -count=1` final PASS, 2.579 s. Optional PostgreSQL cases still require their actual isolated database and are not counted as executed integration acceptance.
- Actual Go/two-browser local saved research + Paper/risk/restart recovery 1/1 PASS, 10568.637667 ms, three clean SIGTERM stops. Retained root `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-R1uF6u`; test binary 11467138 bytes, SHA256 `713220488b939fe633edf4ffba71f30fee65da7301d3ae0e1f2bdf12a166d00d`.
- Gofmt and diff checks PASS. Two initial patch context mismatches made no changes; patches were reapplied against exact function context before testing.

## Honest boundary

The observed-state flag is per-running instance, not a durable tombstone. A wholly new process opened after all prior state is absent can still begin a new workspace; this change does not claim full disaster-recovery/operator admission protection. Original data was preserved by renaming a TempDir fixture file, not deleted from user storage. No production state/Host/Wallet/shared proof/permissions/build graph touched. Browser flow uses controlled local tape/preview tenants, not public prices, human Wallet approval or capital execution. Public/installed release remains unverified pending coherent release-owner integration.
