# Finance Linux preflight lease request — port-bound successor

**State:** `PENDING_CENTRAL_SINGLE_USE_LEASE`; **scope:** `apps/finance/**` only.

This successor binds Finance checkpoint `1bf30018e1626f8228a662114b4814b3a0d3b328` and the frozen Linux-amd64 archive `d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d`. It authorizes only the isolated absent-state preflight, never a production release.

Central must sign one unused `127.0.0.1` port in `1024..65535`, archive carrier path, run directory, command bytes `b23d7850c79fc40357d48595dca7e01d32392c4c76e0ec5c6ef8ec3336f86917`, and inode-rollback command `753f322303cbb264b7cd3f07d7b434ae4d2e2d0f95919768224fb2f5be891f9e`. The script rejects an occupied port before creating its run directory.

Required receipts are cold start from absence; pre/post absence; created state device/inode/owner/mode/nlink/bytes/SHA; stopped exact-inode deletion; final absence; and retained SHA256SUMS. No systemd, symlink, env, Caddy, public route, account request, signature, or transaction is permitted. P0-141/P0-174 remain nonreusable. A later production lease must freshly bind release, binary, env, unit, Caddy, state, service and public rollback values.
