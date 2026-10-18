# Fee-array state-hash encoding candidate

Status: implemented, awaiting source and equivalence validation. Not deployed.

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

New regressions compare all canonical bytes and hashes across chunk boundaries,
historical hash versions, unusual Unicode/HTML, invalid UTF-8, integer extremes,
time zones, late encoding errors and short writes. A real 512-transfer case
checks persistence, full-state restart equality, nonce replay rejection and
late-history audit rejection. The existing benchmark retains the old borrowed
encoder and new candidate side by side on the same real 1024-transfer snapshot.

The existing unpublished performance V13 integration gate deliberately binds
the entire old internal tree. It must continue refusing this new runtime until
a separately pinned derivative candidate is supplied. The old bundle and
published contract are not modified to hide that identity boundary. Source
tests and compatibility/release qualification must be reported separately.
