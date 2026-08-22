# P0 Wallet/Auth recovery runtime acceptance and lease

Integration initially accepted only the immutable `packages/wallet-auth` subtree at `a5a2841e870d7d21df0f761179f2c47d9ca83ccc` (`53790596eeba9388b02cb43ac8cc51939f00ce5d`). A subsequent production-entry audit found that `scripts/ynx-wallet-gatewayd.mjs` mounts only `CanonicalWalletGatewayNodeHost` v1: Product Session v2 modules and tests exist, but `/v2/product-sessions/*` is not publicly mounted. The candidate is therefore not runtime-ready.

Lease `P0-WALLET-CONNECTIVITY-2026-08-wallet-auth-recovery-runtime-lease-20260820T114911Z` was revoked at `2026-08-20T11:56:24Z` before preflight, deployment or any production mutation. It must not be executed or reused. Current public source `49e30d999e9a9cbdd2c565021009f2cab0dc125c` remains unchanged.

Integration replayed Wallet/Auth 222/222, recovery/coordinator 29/29, SDK 13/13, package dry-run, diff and conflict-marker gates. Those results prove the tested modules, not the missing production mount. Product migration remains 0/12; candidate public, installed-client, account, signing, sending, transaction, integratedCentral and aggregate gates remain false.

A replacement candidate must provide an exact pushed source/tree with a durable Product Session v2 Node host, explicit reviewed registry/state environment requirements, registered-origin CORS, restart idempotency, and mode/symlink/hardlink/same-bytes-inode/digest zero-mutation tamper gates. Integration will review that immutable replacement and issue a different lease; no successor is implicitly accepted.
