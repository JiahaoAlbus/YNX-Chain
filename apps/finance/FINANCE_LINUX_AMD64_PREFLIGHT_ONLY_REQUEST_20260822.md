# Finance Linux amd64 preflight-only request

This request resolves the remaining gap in the accepted Darwin isolated proof:
the exact Linux amd64 candidate must execute from an absent state before a
production lease can even be considered.

The requested stage is immutable and bounded:

- archive carrier:
  `/opt/ynx/preflight/finance/artifacts/sha256-d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d/ynx-finance-7824af677dd0-linux-amd64-p0146.tar.gz`;
- run directory: exactly one new
  `/opt/ynx/preflight/finance/runs/<signed-lease-id>`;
- no write may occur anywhere outside `/opt/ynx/preflight/finance`.

The signed command bytes are:

- Linux preflight command, 7,165 bytes, SHA-256
  `b23d7850c79fc40357d48595dca7e01d32392c4c76e0ec5c6ef8ec3336f86917`;
- exact inode rollback command, 1,380 bytes, SHA-256
  `753f322303cbb264b7cd3f07d7b434ae4d2e2d0f95919768224fb2f5be891f9e`.

Central must sign the archive path/digest, both command bytes/digests, run path,
an unused loopback port, host identity, x86_64 condition and retained receipt path.
The command rejects a signed port already held by another service before creating a
run directory. It can only
start the candidate with loopback dependencies and an isolated state file; it then
collects all five P0-174 receipts and stops/cleans up its own processes. The full
run directory is retained as evidence rather than deleted.

It expressly cannot use systemd, the live Finance process, `finance-current`,
production state, environment, Caddy, public routing, or a non-loopback listener.
Any failure is terminal for the preflight lease. A later production lease must
freshly read all live host bindings again; P0-141 and P0-174 remain nonreusable.
