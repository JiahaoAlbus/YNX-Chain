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
