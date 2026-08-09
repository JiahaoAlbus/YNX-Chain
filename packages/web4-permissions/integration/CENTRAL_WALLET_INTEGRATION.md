# Browser and Search central Wallet integration request

Status: **not integrated centrally**. This is an exact input for the owners of Wallet and App Gateway; it is not evidence of registry merge, verifier deployment, or session availability.

Canonical dependency reviewed: `origin/codex/ecosystem-wallet-auth` at `da82c8b07b72b615ccb24b86a2a7ac66ee85b4d8` on 2026-07-18. The central owner must rebase this request onto the then-current canonical branch and run that package’s own parser, signer, Gateway challenge, replay, tamper, expiry, revocation, logout and cross-app tests. Browser/Search must never copy the canonical verifier.

## Registry transaction

Consume `browser-search-wallet-registry-v2.json` through `parseCentralRegistryEntry`. Add the five reviewed entries atomically to the Wallet-side reviewed tuples and central Gateway registry. Add scope explanations:

- `browser:wallet-request`: show an exact Browser-originated Wallet or transaction review; it cannot sign or move funds.
- `search:cases`: associate a public Search correction, removal, or appeal case with the approved public account; it cannot change index policy or move funds.

The Windows entry is intentionally prospective: its product request builder is not implemented in this branch, so do not publish that entry until Windows CI proves the callback and P-256 device proof path.

## Required adapter

After Wallet approval, the product sends the exact authorization request, Wallet approval, and device-signed Gateway completion to the central shared entry point `verifyCentralWalletSession`. Gateway must transactionally read the v2 registry, consume the challenge/replay record, verify exact request digest/client/bundle/callback/algorithm/key/account/sorted scopes/expiry, and write the product-limited session. Every subsequent use calls `assertCentralWalletSessionActive` with central revocation and logout state.

Current Browser/Search callbacks only validate local route, nonce, expiry and product bindings, consume once, and report `gateway-verification-required`. They create no account session. This is deliberate fail-closed behavior until the central adapter is merged and deployed.

## Acceptance evidence needed before flipping `integratedCentral`

1. Wallet registry and Gateway verifier commits containing these exact tuples.
2. Deployed central build IDs and health/version endpoints.
3. Cross-app approval, product-device challenge and session-introspection success.
4. Unknown field, callback substitution, scope escalation, wrong bundle/network/key, tamper, replay, expiry, revocation and logout rejection.
5. Browser/Search staging build IDs proving the deployed clients use the same registry values.
