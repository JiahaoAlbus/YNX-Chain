# Finance Mobile minimal endpoint-validator handoff — 2026-09-20

## Scope

- Baseline: main `1b77b75eb1f6ff3ae020a1833cf6d6ad91a5dbeb`.
- Owner scope: `apps/finance/**` only.
- Keeps the current weekly-v3 Finance Mobile UI, Sandbox behavior, and Exchange/Quant read-only envelope rendering.
- Uses the repository's current `@ynx-chain/wallet-auth` workspace package. No old vendored Wallet/Auth tarball, DApp Connect SDK, native secure-device bridge, or optional Product Session UI was restored.

## Minimal repair

- Restores only the missing endpoint-manifest validator required by current Finance Wallet approval/session calls.
- Aligns `wallet.ts` with the current `App.tsx`/`api.ts` exports: `startWallet`, `completeWallet`, and `gatewayProof`.
- Pins the accepted Wallet Gateway from the manifest and removes caller endpoint injection.
- Runtime recomputes the bundled payload SHA-256 and release checks reject malformed or not-yet-valid windows, expired authority, wrong chain, source/hash/origin drift, premature Finance activation, and a non-fail-closed remote-signature policy.
- Gateway completion uses the current package-root session parser, then binds the returned account, origin, request digest, product/client/bundle/device identity, callback, chain, scopes, purpose, session binding, approval digest, and lifetime to the exact pending request and verified Wallet approval. Any parse, network, or binding failure preserves the pending request for recovery.
- The bundled manifest expired at `2026-09-20T08:45:00Z`; Finance did not extend it. Wallet start, callback completion, proof creation, and bundle release remain `CLIENT_RETIRED` until Integration supplies a new accepted authority.

## Renewed authority required from Integration

The next immutable input must bind exact source commit/tree, canonical JSON schema/version, issued/expiry timestamps, payload SHA-256 canonicalization, protected signer/key identity, fresh endpoint evidence, chain identities, truthful Finance product status, minimum-client policy, and any proven same-chain fallbacks. Finance will vendor and pin that exact accepted input; it will not edit expiry or status locally.

## Truth

- Source/type/test gate results are recorded in the paired JSON evidence.
- Renewed endpoint authority, public/installed release, Wallet approval, signatures, typed data, and transactions remain false.
