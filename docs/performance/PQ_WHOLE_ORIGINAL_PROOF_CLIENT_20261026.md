# Whole original-proof client successor

The Protocol gateway already implements the original Whole envelope at
`/txs/{originalABCIHash}/pq-finality-proof` (Protocol source successor including
`5fd3c464132d2aa53564202fb35c784b226e21b6`). The performance client still
rejected Whole proof collection and independent readback verification. This
change connects that existing contract in the client; it changes no gateway,
consensus, signer, account, fee, nonce, replay rule or protocol wire.

Normal flags are the existing `-pq-whole`, `-pq-collect-proof`, and, for
independent verification, `-pq-readback-only` plus the original absolute
verifier/trust-context paths and independent SHA256 pins. Verification cannot
submit. Collection alone may observe the one original submission but cannot
set independent finality. UNKNOWN remains query-only recovery with no retry.

The exact original wire, native batch hash, ABCI hash, H/index, immutable raw
collector bytes and pinned host context remain bound. A committed partial
Whole requires the collector's `partial` classification rather than complete
`committed` success. Original observed admitted/rejected counts must cover the
batch; independently verified ordered effects must match those counts.
Only admitted native member effect hashes increase finalized business. The
one Whole envelope, rejected members, registration, durable flags or collector
DATA never substitute for finalized business.

The existing original signed public fixture has an actual canonical
`partial-whole` case with three admitted member effects. The production
read-only client test now consumes that original case and invokes the original
offline verifier, with the same independent-context binding, corrupted proof
rejection, cancellation and zero-POST assertions as the existing single-member
test. The response transport is a local HTTP fixture; this is signed synthetic
standard Comet engine QA, not four real nodes or a native authority grant.
The original chain-core job creates fresh original materials and verifier and
runs both tests; a local skip without those inputs is not proof PASS.

A real RED was retained: `TestPQWholeCaseProofOptions` rejected the canonical
Whole collection route. After the repair, three bounded focused Go checks pass
under GOMAXPROCS1/GOMEMLIMIT160MiB, covering options, independent-pin/read-only
requirements, partial collector identity and refusing RPC self-authorization.
Raw files under the existing external chain-performance artifact directory:
`pq-whole-original-proof-options-red-20261026.raw`,
`pq-whole-original-proof-options-green-20261026.raw`,
`pq-whole-original-proof-contract-green-20261026.raw`.
The signed fixture and full race gates subsequently passed original normal CI40222977451; see the actual result below.

The normal workflow builds this current-source successor separately before
checking out the frozen client. Its artifact is
`ynx-pq-performance-successor-client-linux-amd64-<producer commit>` with its own
SOURCE and ELF pins. The existing four-node fresh calibration still consumes
exact `70e7e450997a0ae77dbad5a8be3682f482c6ddd8`; its separate frozen-source build
and artifact remain unchanged. No new successor binary is silently inserted
into that frozen manifest or old once grant. Whole load/finality integration
belongs to a later explicitly bound runtime window after the fresh N1 pair.
This source change is not a sustained TPS or confirmation-latency result.


## Actual full normal CI and binary handoff

Original [CI40222977451](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/40222977451)
completed SUCCESS for `86d9dcfe8d3295a99c574fdc18573ebdd5e90ca2`.
Raw original logs explicitly contain PASS for both
`TestPQMemberCaseOriginalVerifierSignedPublicFixture` and
`TestPQWholeCaseOriginalVerifierSignedPublicFixture` (2.05s and 2.16s whole test
wall times respectively, not transaction finality). The latter's actual
production readback entry/original verifier checks three admitted effects from
a partial Whole, zero POST, wrong-target rejection, corrupted-proof rejection,
and cancellation without process launch or retained success.
The complete source/race/ABCI/release/no-placeholder/secret-scan gates also pass.

The original signed Whole QA test records these one-sample verifier spans:

| Original client span | Measured ms |
| --- | ---: |
| preparation | 208.577213 |
| original verifier process | 302.463968 |
| verification evidence durability | 88.489873 |
| result validation | 26.103269 |
| encompassing verification total | 625.645790 |

These are monotonic spans of the signed synthetic fixture on the Linux CI
runner, with the client under Go1.25 race instrumentation. They are not
four-node inclusion/finality, a percentile population, a paired improvement
claim, or sustained TPS. They include process/file handling; do not attribute
all of process time to cryptography or all of preparation to hashing.

Artifact ID `12610575918`, archive SHA256
`582a06a0a0ebca957b1f2f16b30d882f7a1f8647c8ea70b7dadd05b4b680a86d`,
was downloaded once and matched the original API digest. Its Linux/amd64 ELF
is 38,595,685 bytes, SHA256
`95da2015a1b476e4c3542875f915683f93827a86fa8253033f9108802a1f0217`.
SOURCE.json is 754 bytes, SHA256
`db960fa0ee554d6c73479b94407b2e45584793751606f6cf564392d02060747a`.
Independent local `go version -m` readback confirmed Go1.26.10, Linux/amd64,
compiled VCS86d9 and `vcs.modified=false`; both Git trees, file sizes and hashes
matched. The Mac did not execute the Linux ELF.
The frozen calibration client70e7 was built separately and remains unchanged.

[Machine-readable readback](evidence/pq-whole-successor-ci40222977451-readback.json)
binds the normal log hash, named tests and phase values to this artifact.
Original logs, archive, files and READBACK.json remain under
`/Volumes/西部数据/YNX-large-work/chain-performance-20261017/pq-whole86d9-ci40222977451`.
No new node window, grant, public deployment, native authorization or 1000 TPS
qualification is implied. The next fresh N1 four-node pair remains the original
Protocol/Root scheduled path; a Whole successor must have its own exact runtime
and workload bindings afterward.
