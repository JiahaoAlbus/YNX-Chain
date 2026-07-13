# Next Action

Current single action: implement the first real persistent YNX Bridge coordinator and API runtime.

Why this action:

- Public BFT engineering gates are complete locally, but execution is correctly blocked by an external offline-recovery and four-role owner ceremony.
- Provider-backed AI proof is externally blocked by quota.
- Bridge readiness is part of the full ecosystem target, but the repository currently has no Bridge daemon, persistence, API, or tests.

Required behavior:

- Add a standalone `ynx-bridged` service with persistent restart-safe state and bounded JSON APIs.
- Create transfer intents bound to source chain, source transaction/event identity, source/destination asset, amount, sender, recipient, and minimum finality policy.
- Enforce global source-event uniqueness and exact idempotent replay; reject changed-input reuse.
- Accept attestations only from an explicit relayer allowlist, one vote per relayer, with canonical payload/signature verification and configurable threshold.
- Finalize only after source finality and threshold attestations; prevent double-finalize, amount overflow, unsupported assets, wrong destination, and native YNXT direct-freeze/seizure semantics.
- Persist append-only audit events and expose transfer lookup/list plus health/metrics without leaking secrets.
- Keep external-chain submission disabled: local completion must not be described as a live bridge or third-party integration.

Files to touch:

- `internal/bridgegateway`
- `cmd/ynx-bridged`
- Bridge service config/systemd/deployment wiring only after runtime tests pass
- `scripts/verify/bridge-api-check.sh`
- `Makefile`
- API/custody/acceptance documentation only after real code exists

Validation commands:

- focused Bridge unit, restart, idempotency, signature, quorum, overflow, and tamper tests
- `make bridge-api-check`
- `go test ./...`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make preflight`
- `make objective-state-check`

Completion standard:

- The Bridge service has real persistent code, API handlers, fail-closed policy, tests, smoke target, and deployment package wiring.
- Duplicate source events, unauthorized/duplicate relayers, insufficient finality/quorum, replay conflicts, and unsafe native YNXT actions fail without state corruption.
- Status remains local/not deployed until a real external-chain test and public endpoint are independently verified.

Explicitly not doing:

- No live mint/burn, external-chain transaction, asset funding, relayer key creation, or public bridge claim.
- No freeze, pause, signer install, ingress switch, BFT candidate start, or public cutover.
- No expansion of bounded EVM opcodes, Counter/Hardhat artifacts, or IDE execution.
- Do not modify or replace the long-term goal file.
