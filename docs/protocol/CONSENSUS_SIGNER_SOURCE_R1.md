# Consensus signer source checkpoint R1

The original tests passed in GitHub Actions run 39055064993 at commit
1d0930338c9d33e29f5f4a453f28fe57bcd8671c. Run 39056001285 at
a5466bebcf1b298360db1a9bbeb7f57dc745e59a then established three real failures:
value-copy equivocation, a copied close leaving the original handle usable, and
a final-component symlink forking live history. Both conflicting vote signatures
were cryptographically verified in the equivocation tests. The next fix shares
all mutable signer state and lock lifetime through one core, resolves parent
directory aliases and refuses symlink/non-regular/multiply-linked state files.
The original three regressions remained unchanged and passed in run 39056469787
at ea10ad31a94f80698b73a49ba7638275b5cb571a, together with the full
ynxconsensusauth package and added parent-alias/hard-link controls.
No Comet node has run with this code and no public validator has been activated.

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

## Test scope and evidence

The original routing/codec controls remain explicitly non-cryptographic spies.
New tests use actual fresh CIRCL keys and both real signatures, test each branch
corruption and context/epoch/revocation rejection, and verify copied handles cannot
survive destruction. Unix signer tests cover exclusive writers, exact replay,
same-coordinate conflict, restart, missing/corrupted state, current-registry
rechecks, pre-reservation failure, reservation UNKNOWN, failed final persistence,
and ordinary-precommit/extension binding with exact replay.

Remote isolated CI is authorized and uses GOMAXPROCS=2, -p 1 and fixed timeouts.
Local Go compilation remains outside the current capacity grant. Run 1 and Run 2
raw logs and metadata are saved under docs/protocol/evidence. A passing primitive
or signer test is not engine, quorum, light-client, remote custody or deployment
acceptance.
