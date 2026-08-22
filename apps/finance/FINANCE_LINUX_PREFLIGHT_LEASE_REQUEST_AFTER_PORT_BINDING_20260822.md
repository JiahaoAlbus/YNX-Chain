# Finance Linux preflight lease request — port-bound successor

**State:** `PENDING_CENTRAL_SINGLE_USE_LEASE`; **scope:** `apps/finance/**` only.

This successor binds Finance source `3d70fc3b7b456808c3886fa1a2e2e6395d626100` / tree `12fa68dccde61849f750330a2328b0ad09af8b45` and the frozen Linux-amd64 archive `d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d`. It authorizes only the isolated absent-state preflight, never a production release.

Central must sign one unused `127.0.0.1` port in `1024..65535`, archive carrier path, run directory, command bytes `58f0afe5dfd63135472897fe419276dd2fbc88f4e039e7d7de78b88720b37fd3` (8,927 bytes), and inode-rollback command `753f322303cbb264b7cd3f07d7b434ae4d2e2d0f95919768224fb2f5be891f9e`. The script rejects an occupied port before creating its run directory.

Required receipts are cold start from absence; pre/post absence; created state device/inode/owner/mode/nlink/bytes/SHA; stopped exact-inode deletion; final absence; cleanup; result; and retained SHA256SUMS. `SHA256SUMS` is written last, excludes itself and temporary manifests, then verifies both every listed digest and exact equality with retained receipt files. No systemd, symlink, env, Caddy, public route, account request, signature, or transaction is permitted. P0-141/P0-174 remain nonreusable. A later production lease must freshly bind release, binary, env, unit, Caddy, state, service and public rollback values.
