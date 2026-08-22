# Wallet Protocol Handoff

Checkpoint: `66003e76e804da16d472255efde50cb879055b96` on
`codex/p0-wallet-protocol-20260820`; candidate PR #104.

Integration accepted the P0 behavior and vector contract. The next independent
Wallet Protocol owner must continue from this exact candidate, not redesign
Standard Connection. The remaining scope is Gateway/Router, Device Proof,
Product Session, deep-link registry/callback runtime, client retirement, and
migration vectors. `packages/wallet-auth npm test` passed 112/112 and
`git diff --check` passed at handoff.

The confirmed client defects are inaccurate Finance 4xx classification,
non-durable Finance session state, and reload loss of a product-device key.
No real user approval was replayed and no public fix is claimed.
