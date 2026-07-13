# Next Action

Current single action: produce a verifiable, non-secret owner custody handover inventory and offline recovery receipt for every chain-controlled validator key, service signer, faucet/operator signer, and explicitly documented test/development wallet.

Why this action:

- The dual-format chain feature and production website converter are now deployed and verified.
- Public BFT remains blocked by incomplete offline recovery, owner handover, rotation evidence, remote service-signer readiness, and independent custody review.
- The user explicitly requires ownership of development-team-controlled wallets and signers to be handed over at final delivery.

Required behavior:

- Discover key and wallet roles from source, deployment manifests, server inventories, and existing custody ceremony metadata without reading or printing secret values.
- Classify each role as production validator, service signer, faucet/operator signer, funded test account, deterministic smoke-only account, or external/unknown ownership.
- Record only public identity, role, environment, custody location class, recovery status, rotation status, remote-install status, and handover receipt state.
- Generate an owner-local mode-`0600` handover receipt template that binds the exact public inventory digest and requires explicit owner acknowledgement.
- Verify an offline recovery copy by public-identity derivation or checksum binding without committing, uploading, or displaying private keys, mnemonics, PEM contents, or secret paths that expose credentials.
- Fail closed on duplicate public identities, missing role ownership, unclassified funded accounts, stale manifests, incomplete recovery evidence, or a receipt signed by the same person acting as independent reviewer.
- Keep the authoritative public network online and unchanged throughout this slice.

Files to touch:

- Custody and acceptance tooling in the chain repository.
- Owner-local ignored custody artifacts only under the existing protected custody root.
- No website changes unless a later verified public, non-secret custody/readiness status needs truthful publication.

Validation commands:

- focused unit and fixture tests for inventory classification, digest binding, receipt validation, and failure cases
- existing custody review and production driver checks
- `go test ./...`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make preflight`
- `make objective-state-check`

Completion standard:

- Every discovered chain-controlled identity has a unique role and explicit ownership/recovery/handover state.
- The owner receipt is cryptographically bound to the public inventory while secret material remains outside Git and command output.
- Incomplete or ambiguous custody remains visibly false; no public BFT readiness claim is made.

Explicitly not doing:

- No private key, mnemonic, PEM, token, or secret environment value may be printed, committed, uploaded, or placed on the website.
- No remote signer installation, account funding, freeze, pause, ingress switch, BFT candidate start, or public cutover without the separate recovery and independent-approval gates.
- No expansion of bounded EVM opcodes, Counter/Hardhat artifacts, or IDE execution.
- Do not modify or replace the long-term goal file.
