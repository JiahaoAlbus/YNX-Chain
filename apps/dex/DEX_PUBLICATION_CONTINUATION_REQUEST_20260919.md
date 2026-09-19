# DEX publication continuation request — 2026-09-19

The DEX owner checkpoint is `2871aa7ae77e6221cb14759c3a1fb3478165d029` / tree `a6700c01e2c650a3d3fd743510b4a15e0f6d9510`. Its source implementation is `c71e5b1f2e6dbf5a1cb819348a4bbd9791f8e851` / tree `fdcdc1f7ecab448d50c9eee92bddc46f1bdf5da8`.

Fresh public readback proves `https://dex.ynxweb4.com` is healthy but still serves source `ac775de24176b293b5dbb5ab7114cf29428f8046`, release `ynx-dex-ac775de24176`. The public JavaScript and CSS hashes do not match the new candidate. This is a source drift observation, not deployment authority.

The root shared `product-release.json` still binds `dec1ba994c7c9d48fb4708f37765cb3fe90e2e0f`. DEX owner scope cannot modify that shared file. Central must first review and update the shared release binding to the accepted DEX source, then issue a wholly new DEX-only single-use publication lease that freshly binds:

- exact host, architecture, service, executable, working directory, unit, env, Caddy, state and active release;
- current public root, `/version`, `/health`, dynamic snapshot and current asset bytes/hashes;
- immutable candidate archive and complete asset inventory;
- unique stage, backup and release paths plus exact rollback command objects;
- post-switch source-bound public root/version/health/assets and automatic rollback receipts.

No SSH, upload, restart, symlink/config/state change, Wallet approval, signature, swap, liquidity action or transaction is authorized by this request. Until Central updates the shared binding and grants the exact lease, `publicSourceBound`, `walletApproval`, `swap`, `liquidity`, `transaction` and `productionApproved` remain false.
