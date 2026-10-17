# Consensus signer source checkpoint R1

This checkpoint is source only. It has been formatted and reviewed, but neither
the Go tests nor a Comet node have run with this code. It does not activate a
validator or change the public testnet's authoritative-producer model.

## Actual implementation

`internal/ynxconsensusauth` now contains the existing candidate immutable Comet
proposal/vote/vote-extension request codec and height-specific registry verifier,
plus a concrete CIRCL 1.6.5 pure ML-DSA-87 AND SLH-DSA-SHA2-256f provider. Both
algorithms receive the complete domain-separated consensus message and empty
standard context. This is a separate protocol from transaction batch signing;
there is no aggregation of future votes or claim of transaction-batch savings.

Fresh key generation reads independent CSPRNG material for both algorithms.
`CandidateKey` has no exported unguarded signing operation. Detached public
values do not register validator authority. All copies share destruction and a
mutex; upstream Go heap allocations do not guarantee physical secret erasure.

The candidate `Signer` requires a fixed authenticated activation policy, original
validator address, epoch, trusted height-specific registry, matching opaque key
handle, and durable state path. Every signing request rechecks the exact trusted
pair and validity interval, including cached retries. It reserves complete bytes
at height/round/step durably before signing, and checkpoints the resulting dual
signature before returning it. Different bytes at the same coordinate, including
timestamp-only changes, are rejected. Lower coordinates are rejected.

Vote extensions require the already durably signed exact ordinary precommit.
The persisted companion signature supports whole-vote retries without signing a
second ordinary vote. The extension and ordinary signatures cannot substitute
for one another. Resume checks that stored coordinates match the complete domain
message and verifies any stored signatures under the stored full public pair.

One Unix OS advisory lock protects each state path, including across process
crashes. Unsupported platforms fail closed. New state creation is exclusive;
resume refuses missing state and never silently resets. File writes use a
temporary file, file fsync, atomic rename and directory fsync. A post-rename
durability error returns no signature, retains the exposed reservation in memory,
and requires an exact checkpoint before any subsequent signature can escape.

## Trust and integration boundaries

The anti-equivocation state is trusted anti-rollback storage. Copying a private
key to another signer, initializing another path for the same active validator,
or restoring an older state file defeats that assumption. There is no reset API.
This is the same operational anti-rollback obligation as upstream FilePV; a
protected remote signer still needs its own durable custody and authorization.
This source does not provide validator private-key backup/import or a protected
signer device. Wallet backup success is not evidence of validator key recovery.

This component is not yet a Comet `PrivValidator`, public-key protobuf variant,
Commit verifier, evidence verifier, light client or remote signer. Upstream
v0.38.23 signature-size and transport bounds still reject these larger envelopes.
Those engine changes must preserve validator power/quorum, proposal selection,
historical verification, double-sign evidence and extension enablement rules.
The account policy registry is not a validator-key registry, and the current
public service's validator metadata is not evidence of a running BFT quorum.

## Tests prepared, not executed

The original routing/codec controls remain explicitly non-cryptographic spies.
New tests use actual fresh CIRCL keys and both real signatures, test each branch
corruption and context/epoch/revocation rejection, and verify copied handles cannot
survive destruction. Unix signer tests cover exclusive writers, exact replay,
same-coordinate conflict, restart, missing/corrupted state, current-registry
rechecks, pre-reservation failure, reservation UNKNOWN, failed final persistence,
and ordinary-precommit/extension binding with exact replay.

The next authorized focused command is a bounded single-worker test of
`./internal/ynxconsensusauth`, after the native resource observer is repaired and
the coordinator supplies a fresh heavy-task grant. No test result or deployment
claim is implied by this checkpoint.
