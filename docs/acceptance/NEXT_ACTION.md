# Next Action

Current single action: implement the first real persistent Stablecoin Issuer Control Plane without claiming issuer support.

Why this action:

- Public BFT engineering gates remain externally blocked by offline recovery, owner handover, rotation evidence, independent custody review, and transaction approval.
- Provider-backed AI proof remains externally blocked by quota.
- Bridge coordinator code and deployment packaging are now locally verified at `44870de94b1b`, but external submission, relayer custody, remote deployment, and public proof remain absent.
- Stablecoin issuer readiness is still documentation-only: there is no issuer registry, asset authorization, supply policy, governance decision record, mint/burn intent state, API, or tests.

Required behavior:

- Add a standalone persistent issuer-control service and bounded authenticated JSON APIs.
- Register issuer review requests and represented/canonical asset profiles only through explicit governance decision records.
- Bind each asset to issuer identity, chain/contract reference, decimals, supply ceiling, mint/burn policy, evidence hashes, legal/review status, and revocation state.
- Reject native `YNXT`, gas/resource balances, validator stake, and protocol treasury state from every issuer mint, burn, freeze, seize, or blacklist action.
- Record mint/burn intents only for approved non-native assets, with exact idempotency, amount/supply bounds, issuer authorization, evidence requirements, and append-only audit.
- Keep execution disabled: intent approval must not mint/burn tokens, submit an external transaction, or imply stablecoin issuer support.
- Expose truthful health/metrics and persistent lookup/list/audit surfaces without secrets or unsupported partnership claims.

Files to touch:

- a new bounded issuer-control package under `internal/`
- a standalone daemon under `cmd/`
- an issuer-control smoke/check script under `scripts/verify/`
- `Makefile`
- deployment-package wiring only after runtime tests pass
- API/stablecoin/acceptance documentation only after real code exists

Validation commands:

- focused issuer/asset authorization, restart, idempotency, supply-bound, native-YNXT rejection, revocation, audit, HTTP auth, and tamper tests
- a dedicated stablecoin issuer-control Make target
- `go test ./...`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make preflight`
- `make objective-state-check`

Completion standard:

- The issuer-control service has real persistent code, API handlers, fail-closed policy, tests, smoke target, and deployment package wiring.
- Unauthorized issuers/assets, missing governance/evidence, supply overflow, changed idempotency reuse, revoked assets, and every native YNXT issuer action fail without state corruption.
- Status remains local/not deployed; no issuer, external-chain, mint/burn, or partnership claim is added without separate live evidence and external approval.

Explicitly not doing:

- No live mint/burn, external-chain transaction, asset funding, issuer key creation, stablecoin support claim, or partnership claim.
- No Bridge external adapter, relayer key ceremony, remote Bridge deployment, or public Bridge claim in this slice.
- No freeze, pause, signer install, ingress switch, BFT candidate start, or public cutover.
- No expansion of bounded EVM opcodes, Counter/Hardhat artifacts, or IDE execution.
- Do not modify or replace the long-term goal file.
