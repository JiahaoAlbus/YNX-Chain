# Epoch diagnosis: QA DATA, no production authority

The CLI-only `--epoch-metadata-only` mode uses the existing fixed CDN/numeric IP,
strict TLS/closed resolver/noProxy/noRedirect/noRetry transport, the same ordered
Basic -> Described -> Epoch fetch sequence, per-page/session byte caps, and the
original <=120s absolute lease. It retains only public epoch metadata, not nodes,
identities, IPs, candidates or tokens. The normal/default-off command is absent.
The flag does not authorize a profile, init, gateway, runtime or Browser content.

`qa_epoch_diagnostic.rs` preserves the original ordered epoch/metadata rejection
predicates and 300s boundary. The added `checked_add` fails closed on an
unrepresentable epoch end. Source hashes in output name the official Interval
and NodesResponseMetadata definitions, not a circular hash of this new file.
The build receipt separately binds the actual complete source manifest/binary.

`epoch_controls.rs.in` contains only the new 16 branch/boundary controls. Replace
`__HELPER_PATH_AS_RUST_STRING__` with a correctly escaped absolute Rust string
pointing at the pinned helper. The tested recipe uses the exact coherent locked
Rust1.94 `time` and `serde_json` rlibs; pass their full SHA256 pins plus their
matched `-L dependency=...` graph. No crate downloads/Cargo are needed for this
component. Host-local recipe and actual output: `nym-epoch-diagnostic-20261108/
fixture/attempt-20261108T023158Z-78ffcc/{proposal,receipt}.json` in P05 evidence.
This is not claimed portable CI without that original vendor-supply dependency
stage. Parent owns CI; do not substitute a fake SDK or call a skipped test green.

The two new actual CLI negative controls are portable after the original supply
stage has produced both immutable variants:

```
python3 offline_flags.py --feature-on /absolute/qa-binary --feature-on-sha256 SHA \
  --default-off /absolute/default-binary --default-off-sha256 SHA \
  --output /absolute/new-output
```

They check the default-off command rejection and an expired plan with the new
flag, bounded original Popen/EOF/wait and zero newly created NYM_HOME_DIR files.
They do not rerun the earlier eleven admission cases. Each output must be new.

A metadata diagnosis may finish correctly while the underlying CLI exits nonzero
and the report contains a finite rejection reason. That is observed DATA, never
route readiness or successful full-directory admission. Keep actual CLI exit and
`legacyError` alongside the reason. Do not reinterpret a later epoch result as
proof of fields omitted in an earlier failed response, and do not auto-poll.
