# Native strategy catalog immutable candidate

Source commit: 88ce968f7dce7dcb4bc15760c77fde8089addeb3
Source tree: d7a5b99d24b04726a0bb2fe625cd9e3b7923e6be
Branch: codex/quant-paper-microsite-composition-20261004
Release: ynx-quant-lab-88ce968f7dce

Local archive: /tmp/ynx-quant-composed-88ce968f7-linux-amd64.tar.gz
Bytes: 3935951
SHA256: dcaec25c026e2608443db45e18986a33e20e534f1054277bc574f5f2fb634428

Linux amd64 binary: 8331448 bytes; SHA256 4786daac965888f1e19fb082008b05866dd2c4247fe86e3a848f8a57e835947e
Manifest: 5580 bytes; SHA256 f1df316438cb22bbd18cbde12d0d6841f865712a2be8b4635f89ce9e08633581
SHA256SUMS: 1267 bytes; SHA256 fbaee4d1af4271a4d3955ef591254c583aad3256561e46656710f0598d16dc14
wallet-auth.js: 471204 bytes; SHA256 861e6fdbbbd9cc6fa90dabf5277c7bcaa9d66baafa1835275f62707471cc4775
index.html: 33245 bytes; SHA256 f978c4ddf79e6893567ddd692efb6f201ad96b4821325e85f2667989a37f8884

Package contains binary, 11 original Web assets, manifest and checksums. Packager verifies a clean exact Git source, exact asset bytes and ELF64 x86-64 header. This is a cross-build, not execution of the Linux binary.

## Executed local gates

- Full Node: 329 total, 328 pass, 0 fail, 1 hosted-Wallet environment skip; 107053.964084 ms.
- Go race: internal/quantlab PASS 56.230 s; apps/quant-lab/server PASS 1.455 s.
- Focused reader/model: 15 pass; Go persisted strategy paging/restart test PASS.
- Versioned asset gate: 6 pins PASS; syntax/gofmt/diff PASS.
- Actual local packaged guest Chrome at widths 320, 390, 1280: all 11 assets loaded, no page errors, zero non-GET requests, one tab, English default and display-preference restore.
- Controlled native private-session browser fixtures exercised v2 history; controlled identity is not real Wallet approval.

Retained screenshots: screenshots/native-catalog-88ce968f7/
- quant-320.png: 74112 bytes; e557cd51eeb55b9471bc3a10dd226bea6c0309f1ce4d82c97de8561e1cd78f11
- quant-390.png: 80572 bytes; a2b9a2e9f2d989f4a8dfc60ec50d9db0b344b4f5e0e0594789549eded794ff91
- quant-1280.png: 140999 bytes; 0004aca91281c2b93b5c5ca132a02dbdc6b18cd5b42f2da1b47865de6a217b2c

## Release boundaries

Public deployment, installers, real Wallet approval/callback, signatures, transactions, production signing and Mac ComputerControl remain false/unverified. No SSH, upload, Host modification or public write occurred. Formal publication remains with A/wallet_release_owner. The new reader requires a v2-capable server; publish binary plus Web assets atomically, not a Web-only update. v1 remains supported for older readers; do not roll back to a binary that lacks already-persisted execution-cost semantics. Preserve the prior immutable candidate and use a separately verified current-state/rollback binding before any authorized release.
