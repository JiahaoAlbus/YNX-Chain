# Fee-array state-hash encoding candidate

Status: source and canonical-equivalence tests passed in run 39113606753.
Performance is unmeasured. Not deployed. The full CI run remains red because
the unchanged old V13 source-identity gate rejects the derivative runtime.

This candidate derives from internal tree
`fc5ccab4e9aa6923bc61a2dc7ac518343ac56703`. The original hash leaf and its
tests were preserved byte for byte under the owner-approved Data source staging
directory before editing. Frozen four-node binaries and recipes are unchanged.

The actual CPU profile from run 39111896850 attributed 1090 of 1690 sampled
CPU milliseconds to the state-hash JSON path. This is cumulative CPU attribution,
not a before/after performance result. Complete fee validation and audit hashing
remain separate, unchanged requirements.

For more than 256 fee events, the candidate serializes the surrounding hash
document using the original JSON encoder, identifies its top-level fee array,
and supplies that array in ordered chunks of at most 256 records. SHA-256 still
receives every original canonical byte. Each chunk removes only its enclosing
array brackets and Encoder framing newline; separators are restored between
chunks. Field order, escaping, timestamps, numbers and hash domains are unchanged.
The original single-buffer implementation remains the path for smaller arrays
and is retained as the comparison implementation.

The fee-array temporary buffer scales with a 256-record chunk rather than the
entire fee history. Individual record size is not newly restricted. Other state
fields still occupy the surrounding JSON buffer. No general constant-memory or
CPU speedup claim is made before measurement.

New passing regressions compare all canonical bytes and hashes across chunk boundaries,
historical hash versions, unusual Unicode/HTML, invalid UTF-8, integer extremes,
time zones, late encoding errors and short writes. A real 512-transfer case
checks persistence, full-state restart equality, nonce replay rejection and
late-history audit rejection. The existing benchmark retains the old borrowed
encoder and new candidate side by side on the same real 1024-transfer snapshot.

The existing unpublished performance V13 integration gate deliberately binds
the entire old internal tree. It must continue refusing this new runtime until
a separately pinned derivative candidate is supplied. Kernel commit
`eb6e3199280adde67426e1c04a5403fc1e31d16a` has internal tree
`f1342d3123f2366797e71c65a4e160cac377c9f2`. The old bundle and
published contract are not modified to hide that identity boundary. Source
tests and compatibility/release qualification must be reported separately.

The supplied independent `perf-state-v13-fee-chunks` SDK candidate keeps state
version 13 and application version 19. Its new strict checker and all 53
candidate/current-source controls are connected to the original Chain workflow.
The old candidate, checker and rejection controls remain separate and unchanged.
Full integrated CI still needs to qualify the adopted source.

The default-false `measure_state_hash_encoding` workflow input uses the retained
real 1024-transfer snapshot, SHA-256
`ea203b08c94178ec0132b71f3ec16d731de8e44595f6fd742e331b41d80caf56`.
It compares the original borrowed-buffer encoder and fee-chunk candidate in
the existing Go benchmark, 200 ms per case with three repetitions, one Go CPU
and a 160 MiB Go memory target. Both must reproduce the original AppHash before
timing. The public snapshot and provenance are retained under `fixtures/`;
the original local measurement remains intact. This is an encoding comparison,
not a new executed workload or a network/finality result.
