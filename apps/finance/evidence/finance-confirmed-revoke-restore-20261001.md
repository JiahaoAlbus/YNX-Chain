# Finance confirmed revoke restore boundary

This fixes the Finance consumer restore opt-in, not the shared SDK recovery protocol.

The consumer persisted `ynx.finance.browser-private.9840ef87.wallet-auth.attempted=yes` before explicit authorization, but retained it after a confirmed canonical SDK/server revoke. On refresh, the SDK correctly found no stored session or pending request and followed the consumer's retained opt-in into detected reconnect. Finance's unverified native installation route then produced a new pending request instead of remaining signed out. This is independent of endpoint-authority expiry and does not prove a newly clicked extension approval failed.

The consumer now removes that marker only for a same-generation `disconnected` result carrying `revocationConfirmed === true`. Pending, offline, failed and unconfirmed revocation keep the original recovery intent. No SDK, nonce, proof, scope, callback, clock or authority validation was changed. Central browser identity and Standard Wallet connection remain separate.

Local actual cross-service regression:

```
node --test --test-name-pattern='selected-login-revoke-rebegin' apps/finance/tests/local-product-session-cross-service.test.mjs
```

Result: 1/1 PASS, zero skips, 8.944 seconds. The isolated provider fixture, durable Gateway NodeHost and real Finance Go verifier demonstrate: confirmed revoke; refresh without a new approval; immediate explicit authorization from the normal visible permission panel; a second real Gateway session; the previously written owned category read back through the protected API; failed revoke retained across refresh without another authorization; original revoke retry confirmed; subsequent refresh guest. This is local fixture evidence, not installed-extension or public acceptance. Public final-019 QA must reuse the existing isolated account/profile and verify this successor after deployment.

The generated Wallet bundle and HTML content hash belong to this source slice. Publication requires a new immutable graph/pin built against the accepted current main registry, including the separately owned explicit Quant Paper scope. Old manifest pins are not inherited as valid for new bytes. Quant Paper backend drafts are not part of this slice.

## Immutable compatible successor

Base: `a5eff844590780d526326db458cf45257d61d2c3`, the published accepted Paper registry and graph. Isolated successor branch: `codex/finance-confirmed-revoke-candidate-20261001`. Source cherry-pick: `99b6a91f0` (original source `acda003f4d63a76590f868fbab62d5aeb67c3739`). No shared SDK/Wallet/Paper source changes.

Candidate: `evm-read-runtime-verifier-candidate-confirmed-revoke-99b6a91f-20261001.json`, 74031 bytes, SHA256 `c569d71b27d8b9a4da04d00ebbd6490678039f7ff2f24d4032fc15464457933a`.

Manifest SHA256: `7529bc55cef4fcef968849111b118be1bd6c06dd98d3dd5f5fa62350625b5885`. Wallet bundle: 211423 bytes, SHA256 `17803bda66618d155d931060c06b32d43e02f49f88f89d83bbe43de2aa53e142`. EVM browser/node and central browser retain the exact accepted a5 graph; the candidate independently rebuilds all three twice and Wallet manifest independently rebuilds Wallet twice.

Reproduction (install each existing lock with `npm ci --ignore-scripts` in root, `apps/finance`, `apps/finance/web`, and `packages/wallet-auth`):

```
node apps/finance/scripts/build-guoqing-account-session-candidate.mjs 99b6a91f0 apps/finance/evidence/evm-read-runtime-verifier-candidate-confirmed-revoke-99b6a91f-20261001.json
node apps/finance/scripts/build-guoqing-transport-manifest.mjs ../evidence/evm-read-runtime-verifier-candidate-confirmed-revoke-99b6a91f-20261001.json c569d71b27d8b9a4da04d00ebbd6490678039f7ff2f24d4032fc15464457933a
node --test apps/finance/tests/evm-read-verifier.test.mjs apps/finance/tests/wallet-bundle-verifier.test.mjs
node apps/finance/web/verify-wallet-connect.mjs
```

Related boundary regression: `node --test apps/finance/tests/standard-wallet-flow.test.mjs apps/finance/tests/hosted-wallet-controller.test.mjs apps/finance/tests/private-standard-subject-boundary.test.mjs`: 43/43 PASS, zero skips, 15.419 seconds. Deployment remains the unique release owner's action. This changes only Finance web restore behavior; keep current Gateway/Go identity and product state, signing keys and authority journal. A UI fallback may use the preceding a5 web bundle without restoring old business state, but it reintroduces the diagnosed revoke/reconnect bug.
