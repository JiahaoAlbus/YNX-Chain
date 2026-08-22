# Finance dynamic rollback/preflight package and lease request

## P0-174 correction

Central decision `NO_GO_PRODUCTION_STATE_ABSENCE_ROLLBACK_UNBOUND` is authoritative
at `1dedc4eaa4905ce8325d5764af8d7963b5ae3281`; the record blob is
`129a0ad27746e0b607bd086b122d271ee3357759` with SHA-256
`3c48090be113a91970816b98a1c9070a0250193a5280ef2e75ffa586d171fd81`.

The NO_GO is corrected here without a production action. The new request does not
assume a current release, binary, environment, unit, Caddy, state inode, ownership
or service state. P0-141 remains permanently nonreusable.

The candidate is unchanged: source `7824af677dd052d20321431381523ab302614d98`,
tree `3db34ee2397a49852bbdf15e3841e7c9cecf9444`, Linux amd64 archive SHA-256
`d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d`
(3,937,491 bytes), and root executable SHA-256
`cccdae8ae5b5f694ca7db68540da30582564ff741978e616f7435d448a20fe3e`.

The P0-174 strict-known-hosts read bound `x86_64`, current binary SHA-256
`0cc43c8a77c12975a0fcbada65971f08f2bc3a52345d547ea194dd3ccd60d83f`,
environment SHA-256 `854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252`,
unit SHA-256 `2e72cdad422a3a714c46d074ea97b725233576cf726dbbfd43e82e99c2c2975b`,
Caddy root SHA-256 `077fe80ea9aab24a32d64ba1fab3584e8aab10304e200e58d976d2c33edfb39f`
and Finance route SHA-256 `dcf75a7aed315c54632321b8bb80e44c0abc22f6700fadfbfa9a7da21b88a282`.
It found `/var/lib/ynx/finance/state.json` absent. These facts guide this correction,
but a new lease must read and bind them again before any write.

## Required new-lease proof for absent state

The new lease must bind five receipts for every state path that is absent before
the candidate starts. This is mandatory for the currently reported Finance state
path; no file deletion is allowed without the fourth receipt.

1. Exact candidate cold-start-from-absence proof, including candidate binary hash,
   temporary isolated service identity, and successful local health/version output.
2. Pre-switch absence receipt: an `lstat`-based assertion that the named state path
   does not exist, plus timestamp, parent filesystem device, owner/mode of parent,
   and the signed lease nonce.
3. Candidate-created state receipt: path, device, inode, owner, mode, nlink, bytes,
   SHA-256, timestamp and process/service identity after candidate cold start.
4. Stopped rollback receipt: candidate is stopped first; `lstat` must still report
   exactly the recorded device and inode before deletion. Any mismatch is a
   fail-closed no-delete outcome.
5. Final absence receipt: after deletion and before old service restoration,
   `lstat` must again prove the state path absent; then and only then may the old
   service be restored and its local/public rollback health checks begin.

## Other dynamic fields Central must bind

- Lease ID, nonce, expiry, operator/host/transport identity, immutable archive
  carrier path and archive SHA-256.
- Host architecture, Finance unit path/SHA-256, active state, ExecStart and
  WorkingDirectory.
- Current symlink path/resolved target and their ownership/mode; current executable
  path, bytes and SHA-256; environment path/full SHA-256/ownership/mode and
  redacted WebDir selector; Caddy config path/SHA-256 and local upstream origin.
- Every mutable Finance state file or transaction-consistent database snapshot,
  including signed backup/restore command digests, backup destination and receipts.
- Fresh loopback and public version/health HTTP and body-SHA snapshots, plus
  post-switch and rollback receipt schemas.

## Lease-only sequence and rollback contract

The future lease must first re-read and compare all signed dynamic fields, prove
the five absent-state steps, create any required state and environment backup, then
materialize the candidate in a no-replace directory. Only afterward may it atomically
replace the environment, switch the freshly bound current pointer and restart the
signed Finance service once.

On the first failure, stop the candidate; delete candidate state only with exact
device/inode equality; verify final absence; restore state/environment/current
pointer through signed commands; restore the old service; and require both local
and public old version/health digest verification. The lease is then nonreusable
and must be released. No retry is permitted.

No deployment, public success, Wallet approval, signature, transaction, WalletConnect
or Product Session claim follows from this source-only request.
