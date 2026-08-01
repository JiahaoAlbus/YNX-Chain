# Decisions

## 2026-08-01 Safety Module runtime

1. Safety Module remains a local governed runtime candidate; it is not consensus-active, centrally integrated, publicly deployed or production.
2. The runtime records accounting only. It cannot sign or execute Treasury, custody, insurance funding, slashing transfers or withdrawal transfers.
3. Voluntary stake requires native-wallet YNXT provenance plus Wallet approval and custody receipt evidence hashes. Recursive or derivative provenance is rejected.
4. Cooling stake remains slashable until the cooldown completes.
5. Insurance is consumed before voluntary stake. Residual shortfall is explicit and never converted into a false solvent state.
6. Maximum slash is enforced as a lifetime cap against recorded principal so multiple governance proposals cannot bypass the published limit.
7. Shortfall and insurance-funding decisions require threshold Ed25519 committee authorization, exact action-hash binding, replay rejection and timelock expiry.
8. Direct pushes to protected `codex/final-tokenomics` are not bypassed. Changes must reach it through a pull request and required `test` status check.
