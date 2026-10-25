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
The signed fixture and full race gates still require the normal CI result.

The normal workflow builds this current-source successor separately before
checking out the frozen client. Its artifact is
`ynx-pq-performance-successor-client-linux-amd64-<producer commit>` with its own
SOURCE and ELF pins. The existing four-node fresh calibration still consumes
exact `70e7e450997a0ae77dbad5a8be3682f482c6ddd8`; its separate frozen-source build
and artifact remain unchanged. No new successor binary is silently inserted
into that frozen manifest or old once grant. Whole load/finality integration
belongs to a later explicitly bound runtime window after the fresh N1 pair.
This source change is not a sustained TPS or confirmation-latency result.
