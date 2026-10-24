# Prepared private native snapshot candidate

Measured confirmation-side decode in original400853 diagnostic consumed11.998→11.380s, including strict JSON certificate publication2.590→2.414s and suffix encode1.590→1.328s. This source candidate targets repeated encoding/decoding at that boundary, preserving exact snapshot bytes and private object ownership. It is selected only through the explicit prepared decoder/client flag described below; all default constructors remain unchanged, and current9d frozen four-node run does not contain it.

The private helper first clones and JSON-normalizes the closed native account/fee shape using the existing strict-fallback canonical normalizer, then encodes that same owned object once through the original encoder. It accepts a state object only, never arbitrary supplied JSON. Unsupported record families/schema, invalidUTF8 or invalid times return no candidate, requiring the original route. A prepared object grants no state/signature validation authority: full Validate/Commit and historical checks remain unchanged.

Actual retained1024-history/same binary/AppleM4/Go1.25.7/darwinarm64/GOMAXPROCS1/ABBAAB100ms comparison, both returning independent public and private payload bytes plus the complete normalized private state:

| Component | Original encode + owned strict decode | Candidate private normalize + one encode |
|---|---:|---:|
| Median ns/op |7,012,667|3,022,033|
| Median allocated B/op |4,970,208|2,500,532|
| Allocations/op |11,597|4,001|

Local time reduces56.91% and allocated bytes49.69%. This is not whole decoder/Commit/network latency/TPS or RSS evidence. Private preparation itself does not validate a semantically invalid state. Tests explicitly require such a state to fail full Validate.

Focused byte/object equality, real complete state, nil/empty shapes, Unicode/NUL/HTML/long fields, timezones/monotonic-time normalization, caller array/map/fee mutation, independent public bytes, every other populated record family fallback, invalid strings/map keys/times and concurrent private storage pass under race2.428s. Original strict-decode object and exact public snapshot bytes are the oracle. Initial compile failure from an incorrectly typed test ChainID field was corrected; all initial and green logs are retained. The focused race command is connected to the original Chain Core CI in its own30s step, without enlarging existing timeouts.

Next: bind the new opt-in profile through Hosted controller/verifier/archive consumers, then request a fresh single-axis measurement window. No default promotion or change to frozen9d source is implied.

## Explicit decoder and client integration

`NewBoundedBlockJournalPreparedNativePrefixDecoder` retains the original16..512MiB encoded bounds and native-clone backend. Only its own successful suffix replay can produce a prepared private snapshot. The encode step returns independently owned public bytes; publication retains the already private bytes/object, bound to selected decoder, exact public payload, height/AppHash/Initialized. Original arbitrary-payload `makePrefixCertificate` always uses strict JSON; cold full replay and unsupported schemas/records/string/time cases retain the original path. Every reused private state still runs full Validate, input-prefix digest, payload digest and original current publication/business proofs. There is no cached validation authority or extra resource exemption.

Actual signed18 journal transfers (plus18 duplicate-nonce and18 invalid-envelope rejects) cross two checkpoint epochs with16 actual prepared publications and2 strict cold fallbacks. Control decoder state, exact JSON bytes and replay counters match. Public account/map/fee/payload mutation cannot affect cached private state; older captures cannot displace high water. Mutated private state, private payload or current journal is rejected; fresh decoder recovery and cancellation are checked.

The explicit client flag `-native-prepared-certificate` requires native streaming and rejects mixed canonical/suffix/tip constructions. The durable plan, report, actual constructor inventory and prefix stats carry separate selection identities; prepared acceptance counts aggregate from actual decode branches. Prepared profiles are separately named, and the original8 public archive fixture is not overwritten. Actual102 signed/executed/Commit/native-signature/current-state-readback records across34nonce cycles complete terminal evidence readback, reopen and nonce replay rejection under race. These application tests have synthetic quorum gates, not a network capacity result.

Original defaults/report shape and all byte/queue/observer limits remain. The original focused CI step now selects both private preparation and integrated prefix tests; existing NativeStreaming race selection includes the new client mode. Hosted controller/worker/archive validation for the new prepared profiles remains to be implemented before scheduling such a comparison. Raw tests, first intermediate runs and exact local evidence remain on WD.
