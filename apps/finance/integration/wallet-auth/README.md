# Finance central Wallet integration

These files are the exact, canonical merge input for the shared Wallet Auth v2 registry. They were generated and verified with `@ynx-chain/wallet-auth@1.0.0` from `origin/codex/ecosystem-wallet-auth`.

The central owner must parse `registry-entry.json` with `parseCentralRegistryEntry`, add it to the Wallet registry, and pass the request, approval, and product-device completion to `verifyCentralWalletSession`. The Gateway must issue a revocable, Finance-scoped product session only after that verifier succeeds. Finance does not accept a Wallet secret, recovery material, or a locally synthesized fallback session.

Do not mark `integratedCentral` true from these files alone. It becomes true only after the entry and verifier are merged into the central branch, deployed, and an installed Finance → Wallet approval → Gateway completion → authenticated Finance API flow passes.
