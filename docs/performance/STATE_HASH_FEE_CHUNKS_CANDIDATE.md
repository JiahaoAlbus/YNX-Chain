# Fee-array state-hash encoding candidate

Status: the first candidate passed full integrated CI 39114641191 but regressed
the matched encoding measurement 39114847427. Runtime activation is withdrawn:
the original borrowed-buffer encoder is the default. The revised experimental
encoder passed full Go source tests in run 39115542457. Its independent
borrowed-recovery candidate.3 and normal checker are adopted. Full integrated
CI 39116674848 passed. The revised matched measurement 39116956504 also
regressed: its median was 2,137,304 ns/op versus 1,718,595 ns/op for the
original, 24.36% slower. Allocated bytes were 77,406 versus 76,994 per operation.
Both negative experiments remain preserved and inactive. Not deployed.

This candidate derives from internal tree
`fc5ccab4e9aa6923bc61a2dc7ac518343ac56703`. The original hash leaf and its
tests were preserved byte for byte under the owner-approved Data source staging
directory before editing. Frozen four-node binaries and recipes are unchanged.

The actual CPU profile from run 39111896850 attributed 1090 of 1690 sampled
CPU milliseconds to the state-hash JSON path. This is cumulative CPU attribution,
not a before/after performance result. Complete fee validation and audit hashing
remain separate, unchanged requirements.

The experiment serializes the surrounding hash
document using the original JSON encoder, identifies its top-level fee array,
and supplies that array in ordered chunks of at most 256 records. SHA-256 still
receives every original canonical byte. Each chunk removes only its enclosing
array brackets and Encoder framing newline; separators are restored between
chunks. Field order, escaping, timestamps, numbers and hash domains are unchanged.
The original single-buffer implementation is restored for all runtime calls.
The benchmark invokes the experimental function directly, so it cannot silently
compare the baseline with itself after deactivation.

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
The first adopted source passed full CI. Its immutable bundle is retained;
the revised source must receive its own strict identity qualification.

The default-false `measure_state_hash_encoding` workflow input uses the retained
real 1024-transfer snapshot, SHA-256
`ea203b08c94178ec0132b71f3ec16d731de8e44595f6fd742e331b41d80caf56`.
It compares the original borrowed-buffer encoder and fee-chunk candidate in
the existing Go benchmark, 200 ms per case with three repetitions, one Go CPU
and a 160 MiB Go memory target. Both must reproduce the original AppHash before
timing. The public snapshot and provenance are retained under `fixtures/`;
the original local measurement remains intact. This is an encoding comparison,
not a new executed workload or a network/finality result.

The first matched measurement had three samples per mode on this exact input.
Medians were 1,321,967 ns/op and 76,993 B/op for the original encoder versus
2,065,477 ns/op and 511,707 B/op for the first chunked experiment: 56.24% slower
and 6.65 times the allocated bytes. This negative result is preserved, not a
throughput improvement. The revised experiment removes Marshal's owned scaffold
copy and Decoder/RawMessage value copies by borrowing the encoded scaffold and
finding validated structural boundaries without materializing its fields.
The second same-input comparison above does not establish a CPU or allocation
gain. Further chunk-encoder tuning is stopped in favor of the measured duplicate
seal hash bottleneck. All JSON value encoding, full fee audits,
state validation, canonical-byte and hash checks remain intact.
