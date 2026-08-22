# Exchange publication lease request — source refresh

**State:** `PENDING_CENTRAL_SINGLE_USE_LEASE`; **scope:** `apps/exchange/**` only.

The previous `6edfe066` archive is superseded for publication by source checkpoint `a9cf3d86594ceaf9d5a36d04182590d77acccf0b` / tree `f92bede69b28fdda81586ac245d94d269cd24a83`. Central must first freeze a new Linux-amd64 executable plus the exact current `index.html`, `app.js`, `wallet-connect.js`, CSS and vendored provider assets into one immutable archive and bind every file's bytes/SHA. The old archive must not be deployed as current source.

Before any write, the single-use lease must freshly bind Exchange host, architecture, service/ExecStart/WorkingDirectory, env, Caddy, active release/symlink, state, current executable/assets, and public `/`, `/version`, `/health`, `/api/health` status/bytes/SHA. It must bind immutable stage/backup/release locations, executor and rollback command bytes/SHA, and restore receipts. Rollback restores the exact preflight release, state and public response hashes.

The candidate exposes separate YNX Wallet and MetaMask selection without custom-scheme navigation. It authorizes no account request, signature, order, trade, Product Session, or public-completion claim.
