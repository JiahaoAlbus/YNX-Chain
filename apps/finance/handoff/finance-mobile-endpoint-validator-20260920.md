# Finance Mobile endpoint-validator handoff — 2026-09-20

## Scope and inheritance

- Owner scope: `apps/finance/**` only.
- The coherent Finance Mobile checkpoint was restored from accepted source `f1fe9681a` after `fc719631204714d135627f9f5b351e6559171024` deleted required Finance-only modules while leaving their imports in place.
- No Wallet/Auth, shared endpoint, RPC, Faucet, Website, or other product path was modified.
- Standard Wallet connection and optional Product Session remain separate. Finance product API status remains `PENDING`.

## Fail-closed behavior

- Bundled authority source: `fa0ffd9bbbcc831438078be8e19cebff51b07e5e`.
- Manifest version: `1.0.0-p0.2`.
- Payload SHA-256: `3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5`.
- Authority window: `2026-08-20T08:45:00Z` through, but excluding, `2026-09-20T08:45:00Z`.
- Runtime validation now rejects malformed windows, expiry, wrong chain, source/hash/origin drift, premature Finance activation, and non-fail-closed remote-signature policy.
- The release verifier performs the same expiry and signer-policy gates. Finance does not update `expiresAt`, endpoint status, or signature truth.

## Required renewed authority input from Integration

A future update must arrive as one independently accepted immutable input containing:

1. exact Integration source commit and tree;
2. canonical JSON schema and manifest version;
3. `issuedAt` and `expiresAt` with `expiresAt > issuedAt`;
4. exact payload SHA-256 under the declared canonicalization rule;
5. protected signature, signature algorithm, signer/key identifier, and independently accepted key registration/rotation record;
6. canonical RPC, EVM RPC, REST, Wallet Gateway, Faucet, Explorer, Indexer, and Monitor origins plus fresh status/version evidence;
7. exact chain identities `ynx_6423-1`, `6423`, and `0x1917`;
8. truthful Finance product API status, source-bound public version if activated, and minimum-client policy;
9. explicit fallback origins only where same-chain equivalence has been proven.

Finance output must vendor the exact accepted JSON, pin its source and payload identity in runtime and release verification, and rerun clean install, typecheck, unit, security, canonical-authorize, endpoint and bundle gates. A remote or locally edited manifest is rejected.

## Truth boundary

- Source restored and locally verified: true.
- Local embedded-JS Android APK build/install/cold-start/second-start: passed on `emulator-5580`; APK is debug-key signed and is not a production or hosted installer.
- Expired-authority rejection: tested at the exact boundary; live CLI evidence recorded after expiry in the paired evidence file.
- Renewed endpoint authority accepted: false.
- Finance product API public/verified: false.
- Public or installed Mobile release: false.
- Wallet approval, Product Session lifecycle, signature, typed data, and transaction evidence: false.
