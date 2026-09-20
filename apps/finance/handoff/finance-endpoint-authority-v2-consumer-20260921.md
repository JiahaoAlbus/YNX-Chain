# Finance Endpoint Authority v2 consumer handoff

Implementation checkpoint: `f2c4cb6547db9477ad6a45b1ceaaee835b3f888d` / tree `2f882c2ec72b248534d5509496d64f55fba1b6b7`, based on `42e0abaa46bcaa6a14158a78e70d1fcbde13e06e`.

The Finance consumer now uses the shared `sdk/js/endpoint-authority-v2.js` verifier. It does not copy its Ed25519, canonicalization, policy or progression logic. Server requests pass a fixed absolute Node executable and script with no shell and no request-derived arguments. If v2 is absent, partial, expired, revoked, equivocated, clock-rolled-back, CAS-conflicted or storage-lost, Product Session fails before Wallet Gateway network access; guest and Standard Wallet remain independent.

Web uses one IndexedDB read-write transaction for checkpoint CAS, a separate durable initialization marker for loss detection, an explicit trusted clock, persistent cross-tab invalidation and re-verification at begin, restore/callback, proof and order-persistence boundaries. Node uses no-follow file-handle reads, fstat on the opened handle, a lock plus fsync/rename CAS checkpoint, a restart clock high-water mark and a loss marker. Mobile 1.2.0 exposes capability rejection only: Expo digest/SecureStore are not presented as Ed25519/durable CAS.

The release builder carries the exact helper source graph at `authority-runtime/apps/finance/...` plus the unchanged shared SDK v2 verifier. The reproducible Linux amd64 candidate is `/tmp/ynx-finance-f2c4cb6547db-linux-amd64.tar.gz`, 30,496,609 bytes, SHA-256 `4ded4967ea14ec94eadcbae784c45a6e57d51f1f2b944fdc68d42cf7b0faaaf8`. It is local and unpublished.

Tests passed: Finance Node 66/66, authority adapter 5/5, Mobile 18/18 plus typecheck and Android/iOS Expo export, wallet reproducibility verifier, Finance security/smoke, and Go race/vet/build for all Finance packages. Chromium directly exercised valid and invalid signatures, two-tab same-sequence equivocation, checkpoint loss, clock rollback, expiry and key revocation with no private network.

Truth remains false for public deployment, protected manifest activation, installed Wallet callback, provider verification, official Sandbox, production approval, account approval, signing and transactions. Activation requires Central-provided protected trust root and signed manifest, trusted-clock feed, durable checkpoint path and a separate deployment lease. Rollback is the prior deployed Finance release; no runtime was changed by this work.
