# Fresh financial public readback and release dependency

Owner source checkpoint inspected: 848d407ec636ed3e1b0d40ef7523eea004b019da, tree 75cc0bb65fe76c531973e52fb4e3742851f4c33f. Worktree clean before this evidence. This record is direct public read-only evidence, not a deployment claim.

Bounded HTTPS GET (8 second deadline per request, no auth, no writes):

| Product / canonical endpoint | HTTP | bytes | body SHA256 | returned commit |
|---|---:|---:|---|---|
| Finance /version | 200 | 140 | 4f29004ada07b1460807d189a4cc7c394bd704038fb12212268ee854777654d3 | 81e08b49d1eec3d901433e54d6b35227be43b6b3 |
| Finance /health | 200 | 557 | 438bdb4da5eaf42fe8256dba0970eb6ad7fc72b7e618da81572eed4b517f3268 | 81e08b49d1eec3d901433e54d6b35227be43b6b3 |
| Finance / | 200 | 36630 | b031844873eabf9eebfbd68e652e36c019411e483bcbc5cd02fe7a8d97755b80 | HTML, not version evidence |
| Exchange /api/version | 200 | 107 | b4c022607d648d184914ec7e9041fc4e7c5c2ce5fcc13392f18350bfc2a6d8a8 | 91c1a40587d28ad4c931d4a4d601766bd467ea20 |
| Exchange /api/health | 200 | 307 | 9d16623ea43cc49bd257b1043c14bd1f1cd1d68a8df4b8e754a1ff2c5dbdc7de | 91c1a40587d28ad4c931d4a4d601766bd467ea20 |
| Exchange / | 200 | 15995 | e19bfb7281f35515b5d5648f893803af94ea3a0c64ed46d766f3495a8e7b63ab | HTML, not version evidence |
| Quant /api/version | 200 | 274 | f82629a1bd63e50f6721611cbf7866f86d7bffd51820b05a417590541c4653df | 664b80b00ac576317524f25b49fc01d1c0db7196 |
| Quant /api/health | 200 | 462 | 9f20f70d5719359683c2f2e4a0dabacd7003072d01b16e1930520ea79b01b4cb | 664b80b00ac576317524f25b49fc01d1c0db7196 |
| Quant / | 200 | 22457 | 216e54c8b2e79835bd52d4802d5c805ae864c6702b54db9508abae284c93ec32 | HTML, not version evidence |

Quant version/health explicitly report filesystem_json_snapshot, multiInstance=false, productionDatabaseRequired=true. This contradicts public multi-instance readiness; local PostgreSQL proofs do not substitute for production configuration. Exchange /version and /health both return identical 15995-byte HTML: reject these as JSON release receipts even though HTTP is 200. Finance /api/version and /api/health, Quant /version and /health return 404 (19B SHA b16e15764b8bc06c5c3f9f19bc8b99fa48e7894aa5a6ccdad65da49bbf564793). Use canonical endpoints above.

Personally opened public https://finance.ynxweb4.com/ in Codex browser tab8: URL resolved #overview, English default, service reachable / Wallet not connected, guest overview explicitly shows no account data. Clicked only Connect a wallet to reveal chooser: distinct YNX Wallet browser extension, Mobile YNX Wallet, MetaMask browser extension, YNX Web Wallet. Clicked Cancel connection: returned to same #overview and focus to Connect a wallet. No provider selected, no account approval/signature/private session/action attempted. This proves chooser visibility/cancel behavior on this old public source, not provider interoperability or latest ordinary inputs. No screenshot/installed proof claimed.

Executable release dependency for Central/A: integrate ordinary-hunk manifests plus successor commits 3b406ca5e and 848d407ec into the current formal authority; freeze final coherent assets/Go source and exact deployed version; configure actual Quant PostgreSQL with retained namespace/data compatibility and verify readiness/multiple authenticated users. Do not deploy this mixed owner checkout wholesale, overwrite SDK/SSO/grants/pins, or infer production permission from this record. Exact host rollback/config/lease remains release-owner work. After source-bound release, this owner can rerun non-sensitive public flows; account/sign/transactions require the separate approved user flow.

All productComplete, newSourcePublic, installed, realWalletApproval, realOrders and aggregate gates remain false. Existing public identity engineering evidence in Central DELIVERY is preserved but cannot prove these ordinary successors deployed or private product business completed.
