# P0 Wallet/Auth recovery runtime acceptance and lease

Integration accepts only the immutable `packages/wallet-auth` subtree at `a5a2841e870d7d21df0f761179f2c47d9ca83ccc` (`53790596eeba9388b02cb43ac8cc51939f00ce5d`) for one controlled Wallet/Auth runtime transaction. The Owner branch moved after handoff; successor commits are not accepted, and no whole-tree merge is authorized.

The new lease is `P0-WALLET-CONNECTIVITY-2026-08-wallet-auth-recovery-runtime-lease-20260820T114911Z`, owned by Wallet Protocol and executable only by the Wallet/Auth Gateway runtime deployment owner before `2026-08-20T13:49:11Z`. It binds the already accepted registry SHA-256 `ae156b317b9a97bfd42397cca634021deefe10ffb009102899e24276d8721e31`, preserves current public source `49e30d999e9a9cbdd2c565021009f2cab0dc125c` as the rollback source, and requires exact candidate source/readback after activation.

Integration replayed Wallet/Auth 222/222, recovery/coordinator 29/29, SDK 13/13, package dry-run, diff and conflict-marker gates. Product migration remains 0/12. This acceptance is not a deployment result: candidate public, installed-client, account, signing, sending, transaction, integratedCentral and aggregate gates remain false until the lease executor returns direct public evidence.

The transaction may modify only the Wallet/Auth runtime. It may not touch Wallet UI/platform code, 6437, 6439, 6441, Chain Core, Website, Developer SDK, Shop or another product. Preflight, verified backup, rollback drill and the complete public negative/race/restart acceptance matrix are mandatory.
