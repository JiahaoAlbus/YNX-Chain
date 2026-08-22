# Finance isolated absent-state preflight

This source-bound preflight directly answers P0-174 without deploying. It ran the
exact Finance source commit `7824af677dd052d20321431381523ab302614d98` in a
fresh local directory with no state file, reached matching `/version` and
`/health`, executed one controlled local state write through the HTTP service, then
stopped the service and removed the state only after exact device/inode equality.
Final absence was recorded before cleanup.

The five receipts passed: cold start from absence, pre-switch absence, created
device/inode/owner/mode/nlink/bytes/SHA, stopped exact-inode deletion, and final
absence. Their complete immutable digest list is in the adjacent JSON evidence.

The two executable command bodies are committed at these exact digests:

- `finance-isolated-absent-state-proof.sh` —
  `0b23f35473b712c3480b2336d1369b88f08b374ca29d5672d0d5729936e1d751`
- `finance-absent-state-rollback-command.sh` —
  `753f322303cbb264b7cd3f07d7b434ae4d2e2d0f95919768224fb2f5be891f9e`

They are commit-bound command bytes, not a Central production signature. A new
Finance-only lease must sign these exact bytes and freshly read host values. It
must also supply any host-specific environment/current-pointer backup and restore
commands. P0-141 and P0-174 remain nonreusable.

The production Linux amd64 archive was integrity-verified but not locally executed:
this macOS host has neither a running Docker daemon nor a Linux emulator. The
executed binary was a Darwin/arm64 build of the same exact source and build identity.
This is not public, installed Wallet, approval, transaction, or Product Session
evidence.
