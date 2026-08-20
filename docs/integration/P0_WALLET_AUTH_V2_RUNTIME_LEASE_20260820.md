# P0 Wallet/Auth Product Session v2 runtime lease

Integration accepts the immutable seven-file Wallet/Auth runtime mount at `6cf3ef845202bd879ed94515a71b323dd2fc9e14`, exact `packages/wallet-auth` tree `4c544d2e2ddb63caef536ea67c8f27b45044fd89`. Handoff `0ed75659e8fd3e1556d8a9b3789b22b1ac94c89e` explicitly replaces the withdrawn `a5a2841e` candidate. The revoked a5a lease remains non-reusable.

The production entry now preserves the v1 administration/runtime and sends five exact `/v2/product-sessions/*` routes to a separate durable Product Session Node host. Remote activation fails closed unless both the reviewed v2 registry and an independent v2 state path are explicit. The accepted v2 registry is blob `4f1f1326031f1dade8eaaaee4673ee96badd0259`, SHA-256 `d2826eb419abca4444ccb50d79537fa7f6a3643948d82ed9b52914b7169c107b`.

Lease `P0-WALLET-CONNECTIVITY-2026-08-wallet-auth-v2-runtime-lease-20260820T120255Z` was superseded before start at `2026-08-20T12:10:54Z`. The seven changed files import Product Session v2 dependencies that are absent from public source `49e30d999`; the limited materialization cannot cold-start. No backup, deployment or production mutation occurred, and this lease must not be reused.

Central replay passed Wallet/Auth 231/231, combined v2 21/21, Node host 6/6, daemon 2/2, SDK 13/13, package, diff and conflict-marker gates. Current public source remains `49e30d999e9a9cbdd2c565021009f2cab0dc125c`. Candidate public lifecycle, installed client, 12-product migration, enhanced SDK, integratedCentral and aggregate claims remain false until direct lease evidence passes.
