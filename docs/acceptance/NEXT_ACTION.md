# Next Action

Current single action: bind production custody review to the exact validated owner-handover receipt and inventory digest.

Why this action:

- The public identity inventory and mode-`0600` default-false owner packet now exist and are locally verified.
- The current production custody review independently repeats recovery/handover assertions but does not require the owner receipt, so the evidence chain is not yet end-to-end.
- Public BFT must remain impossible until the owner receipt, independent custody review, and transaction approval all bind the same commit and signer identities.

Required behavior:

- Extend the production custody review packet with owner-handover inventory digest, inventory file SHA-256, receipt SHA-256, owner identity, and independent owner-handover reviewer identity.
- Invoke `validate-owner-handover-receipt.mjs` from the production custody validator and compare its commit, five service signers, recovery/handover/rotation assertions, and exact hashes.
- Require the production custody reviewer to differ from both the owner and owner-handover reviewer.
- Reject missing, unacknowledged, stale, expired, self-reviewed, tampered, mismatched-manifest, or free-form owner evidence.
- Propagate the exact owner evidence hashes into custody validation output so later freeze/cutover approval cannot substitute another packet.
- Keep the real packet unacknowledged until external owner and independent-review procedures actually occur.

Files to touch:

- `scripts/ops/write-production-custody-review-packet.mjs`
- `scripts/verify/validate-production-custody-review.mjs`
- `scripts/verify/production-custody-review-check.sh`
- Transaction fixture/check files that construct production custody reviews
- Custody and acceptance documentation

Validation commands:

- `make owner-handover-check`
- `make production-custody-review-check`
- `make public-bft-freeze-rehearsal-transaction-check`
- `make public-bft-cutover-transaction-check`
- `make public-bft-production-driver-check`
- `go test ./...`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make preflight`
- `make objective-state-check`

Completion standard:

- No production custody review validates without an exact valid owner receipt and inventory.
- Owner, owner-handover reviewer, custody reviewer, and transaction approver separation is enforced at the appropriate gates.
- Exact hashes and commit identity propagate through owner receipt, custody review, and transaction approval evidence.
- Incomplete real-world handover remains visibly false; no signer install, network mutation, or public BFT claim occurs.

Explicitly not doing:

- No private key, mnemonic, PEM, token, or secret environment value may be printed, committed, uploaded, or placed on the website.
- No remote signer installation, account funding, freeze, pause, ingress switch, BFT candidate start, or public cutover.
- No expansion of bounded EVM opcodes, Counter/Hardhat artifacts, or IDE execution.
- Do not modify or replace the long-term goal file.
