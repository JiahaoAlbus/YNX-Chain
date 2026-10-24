# Prepared private native snapshot candidate

Measured confirmation-side decode in original400853 diagnostic consumed11.998→11.380s, including strict JSON certificate publication2.590→2.414s and suffix encode1.590→1.328s. This source candidate targets repeated encoding/decoding at that boundary, preserving exact snapshot bytes and private object ownership. It is not selected by any decoder/public API or the current9d frozen four-node run.

The private helper first clones and JSON-normalizes the closed native account/fee shape using the existing strict-fallback canonical normalizer, then encodes that same owned object once through the original encoder. It accepts a state object only, never arbitrary supplied JSON. Unsupported record families/schema, invalidUTF8 or invalid times return no candidate, requiring the original route. A prepared object grants no state/signature validation authority: full Validate/Commit and historical checks remain unchanged.

Actual retained1024-history/same binary/AppleM4/Go1.25.7/darwinarm64/GOMAXPROCS1/ABBAAB100ms comparison, both returning independent public and private payload bytes plus the complete normalized private state:

| Component | Original encode + owned strict decode | Candidate private normalize + one encode |
|---|---:|---:|
| Median ns/op |7,012,667|3,022,033|
| Median allocated B/op |4,970,208|2,500,532|
| Allocations/op |11,597|4,001|

Local time reduces56.91% and allocated bytes49.69%. This is not whole decoder/Commit/network latency/TPS or RSS evidence. Private preparation itself does not validate a semantically invalid state. Tests explicitly require such a state to fail full Validate.

Focused byte/object equality, real complete state, nil/empty shapes, Unicode/NUL/HTML/long fields, timezones/monotonic-time normalization, caller array/map/fee mutation, independent public bytes, every other populated record family fallback, invalid strings/map keys/times and concurrent private storage pass under race2.428s. Original strict-decode object and exact public snapshot bytes are the oracle. Initial compile failure from an incorrectly typed test ChainID field was corrected; all initial and green logs are retained. The focused race command is connected to the original Chain Core CI in its own30s step, without enlarging existing timeouts.

Next: integrate only into a separately selected private publication constructor with clear producer ownership; preserve all original strict decoding fallback and full validation; verify real signed prefix reuse/corruption/recovery before any network window. No default promotion or change to frozen9d source is implied.
