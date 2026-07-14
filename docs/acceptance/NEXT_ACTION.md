# Next Action

Current single action: build a deterministic exchange integration conformance and listing-readiness evidence package without claiming exchange submission or listing.

Why this action:

- Commit `56cd3d1a1a23` completes the canonical Chainlist/EIP-3085 candidate, bounded wallet helper, strict local package verification, and operator-controlled live endpoint proof.
- `scripts/verify/exchange-integration-check.sh` currently proves only a local Faucet deposit, unsigned local transfer, receipt/log lookup, and height growth. It does not define the production exchange contract or fail closed on metadata drift, address ambiguity, unsupported RPC assumptions, confirmation policy, package tampering, or false listing claims.
- This gap can be advanced entirely with code, deterministic fixtures, and read-only public checks. Exchange submission, custody, credentials, private keys, and partnership claims remain external.

Required behavior:

- Define one canonical exchange network/asset profile derived from YNX Testnet metadata: chain/network ID `6423`, EVM `0x1917`, native `YNXT`, 18 decimals, exact RPC/Explorer URLs, testnet status, and explicit `memo/tag not used` policy.
- Bind canonical lowercase EVM `0x...` and checksummed `ynx1...` representations to shared address vectors; define which format exchanges should store, display, query, and use for EVM signing without inventing a second account.
- Publish an exact supported/unsupported RPC capability matrix based on real implementation and tests, including chain identity, block/transaction/receipt/log/account queries and transaction broadcast boundaries.
- Add deterministic signed-transaction fixtures for deposit recognition and withdrawal broadcast validation using test-only keys; production custody keys must never be read, generated, or packaged.
- Define bounded confirmation/finality, duplicate deposit, idempotency, restart/resume, stale index, failed receipt, wrong-chain, malformed address, and unsupported-method behavior. Do not claim reorg resistance that the current authoritative producer/follower network cannot prove.
- Replace the happy-path shell check with structured fixtures and verifiers that reject metadata drift, address mismatch, chain mismatch, changed transaction/receipt/log evidence, unsafe files, noncanonical JSON, package tampering, and any `listed/submitted/partnered=true` field.
- Generate a deterministic testnet-only exchange package with exact Git commit, file digests, capability status, operator-controlled evidence status, and explicit `exchangeSubmitted=false`, `exchangeListed=false`, `exchangePartnership=false`.
- Add a bounded public read-only probe for chain identity, growing height, account/address equivalence, transaction/receipt/indexing availability, Explorer resolution, and release identity. Separate this from local mutation fixtures and mark it non-independent.
- Wire focused tests, `make exchange-integration-check`, `make exchange-package`, a dedicated package-integrity target, ecosystem packaging, and `make preflight`.
- Update exchange/API/acceptance documentation only after the executable contract and checks exist.

Files to touch:

- `chain-metadata` or a new canonical exchange profile derived from existing metadata
- `testdata` for bounded address and signed transaction vectors
- `scripts/lib`, `scripts/package`, and `scripts/verify` for exchange candidate generation/verification/live proof
- `Makefile` and `scripts/deploy/preflight.sh`
- `docs/exchange-listing` and acceptance documentation after implementation

Validation commands:

- focused profile, address, capability, signed-vector, confirmation, tamper, false-claim, and live-probe tests
- `make exchange-integration-check`
- `make exchange-package`
- a dedicated deterministic exchange-package integrity check
- `make address-codec-check`
- `make wallet-integration-check`
- `make sdk-check`
- `go test ./...`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make preflight`
- `make objective-state-check`

Completion standard:

- One canonical profile and shared vectors define exactly how an exchange identifies YNX Testnet/YNXT, handles both address representations, observes deposits, validates withdrawals, and interprets supported RPC results.
- Deterministic fixtures and package checks fail closed on every named drift/tamper/false-claim boundary; the bounded public probe confirms only currently observable operator-controlled testnet behavior.
- Status remains readiness-only until an exchange independently reviews the exact package, controls its own custody/signing path, validates public behavior, and explicitly approves listing.

Explicitly not doing:

- No exchange application, listing claim, partnership claim, logo use, credential access, custody integration, production key generation, real withdrawal, or paid listing action.
- No mainnet claim or mainnet metadata endpoint publication.
- No claim of reorg/BFT finality beyond currently verified authoritative producer/follower behavior.
- No Chainlist acceptance, wallet default support, stablecoin issuer support, bridge production readiness, npm/PyPI publication, third-party partnership, or public BFT completion claim.
- No public BFT freeze, signer install, ingress switch, or cutover without existing custody and transaction approvals.
- No expansion of bounded EVM or IDE execution.
- Do not modify or replace the long-term goal file.
