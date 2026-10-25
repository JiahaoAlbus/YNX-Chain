# ABCI Whole transfer source candidate R1

This is an implementation candidate on production-source worktree `ynx-pq-public-upgrade`, after the Run8 passing baseline `69e788b4bd726689ea5d1709fd5ba0162c6ec0da`. Source inspection began at evidence-only HEAD `dbf3b850cff086a505b17ff5bf74f1f3a84b88f7`. It is not part of Root's first N1 performance candidate. No local Go build/test, benchmark, service, deployment, or end-to-end transport acceptance was performed for this change. `gofmt` and whitespace checks are the available local validation; the new tests require Root's remote CI.

The earlier design is frozen at `CONSENSUS_PQ_ACTION_INTEGRATION_PLAN_R1.md`, SHA256 `6e1378e850bbafb6c289d1847ba1fb5af84e0b9d79a41ff7bc66e97dca232ce8`.

## Execution and identity

`pq_whole` is a strict, re-encoded canonical JSON transport for the original Whole wire. Raw Whole is bounded by the existing `chain.MaxPQBatchBytes` (8 MiB); the outer JSON bound is `2*MaxPQBatchBytes+256`. Ordinary member/migration/revocation and classic Action bounds retain their previous constraints. Unknown, duplicate, trailing, uppercase-hex and noncanonical outer fields fail canonical equality. No transaction or validator signing domain changes.

`authenticateConsensusBatch` uses the existing `ynxbatch.DecodeWhole`, `EncodeCertificate`, and standard `Verifier.VerifyWholeBatch`. The resolver calls the complete trusted policy's `TrustedRegistration` at the actual execution height. Both independent signatures and both complete message trees must pass. A private admission object lasts one call; every member resolves current eligibility again and compares the full record, key pair, algorithm and activation schedule. No `Enabled: true` shortcut, caller-provided verification flag, fake Member proof or classic signature is used.

Authentication failure has no business effects. Authenticated members execute in canonical index order against the state left by earlier successful members. A rejected member contributes no fee, nonce, bandwidth, balance, lots or receipt change. Each member gets detached copies of every transfer-mutated branch; failed candidates are discarded. A later member may use the same next nonce as a failed earlier member. Unsupported native Action messages are per-member rejections; another transfer in the same genuine Whole may succeed. This is the source `SubmitPQBatch` transfer-only policy, not an arbitrary Action escape hatch.

All-rejected batches return per-index rejection data with a nonzero ABCI result and store no proof or ledger effects. PrepareProposal excludes such a candidate. A partially successful batch yields one successful ABCI transaction and an ordered result for every member. The result does not claim persistence before Commit or pretend that the members were separate Comet transactions.

Three identities remain separate:

- `ABCITransactionHash`: hash of the actual canonical outer JSON.
- Batch hash: hash of the original complete Whole bytes.
- Native member hash: the existing exported `chain.PQBatchTransactionHash(batchHash,index)`.

Each admitted native transfer receipt and fee receipt uses its native member hash. `PQHistory` records that member hash, the actual outer hash, execution fields/time, and the canonical original `ynx-pq-batch-member-v1:<hash>:<index>` reference. The certificate is not duplicated per member.

## State and restart

`CommittedState.PQBatches` is an optional map of `PQCommittedBatch`, embedding the original `chain.PQBatchProof` plus the actual outer hash. The complete proof appears once in the existing committed state alongside accounts and receipts. It is included in the existing AppHash document, deep clones, seal, persisted file, initial-state guard and legacy-version guard. Empty/nil omission preserves existing state JSON/hash representation. This is not a parallel account ledger.

Whole admission first checks both the live proof map and immutable migration `Runtime.PQBatches`. A committed partial Whole cannot be resubmitted to retry previously rejected indices under later balances/nonces. The `/pq-batches/<batchHash>` read-only query returns the original target proof/outcome, or the original source proof/outcome if imported. Source history is not replayed or relabeled with an invented Comet hash. This replay rule applies to that original Whole; the existing independent Member authorization protocol is not silently redefined.

Restart validation authenticates each complete Whole once at its original height and verifies:

- Canonical full proof hash, actual outer transport hash and original execution height after migration.
- Exactly N ordered outcomes, bounded rejection text, and at least one admitted member.
- Admitted reference -> one original member -> one matching native receipt and one matching fee receipt, with original hash, sender, recipient, amount, fixed fee, nonce, height and timestamp.
- Rejected member -> no transaction reference, native receipt or fee receipt.
- No orphan proof/reference, duplicate reference, reordered/interleaved batch history, or unconsumed recorded nonce.
- No injected source logs, block hash, sponsorship, resource metadata or fee-lot receipt on this transfer path.
- Complete v1/v2 policy and historical eligibility: a later tombstone blocks new admission while preserving an original pre-revocation Whole.

Live continuation also forbids removing/changing any old shared proof or ordered partial result, in addition to the existing policy/history append-only checks. AppHash binds these committed outcome records; signatures authenticate the original messages, not a fabricated signature over business results. Comet/state-sync trust in the committed AppHash remains a separate consensus boundary.

## Accounting semantics preserved and known differences

An admitted transfer consumes exactly amount+fee from the sender, credits amount to the recipient and fee to the existing ABCI fee recipient, advances sender nonce once and bandwidth once, and moves sorted traceable lots for amount only. No fee lot is added to the transfer path. Revocation continues to have its separate real fee-lot behavior.

The shared authorized-transfer executor now checks net recipient credits before writes, including sender/recipient/fee aliases, and prevents recipient lot overflow. A failure after partial lot planning can only affect a detached candidate. These checks close overflow acceptance for ordinary target transfers too; they do not rewrite historical receipts.

There are existing source/target differences that this candidate does not silently change:

- Source account migration moves a fee lot; Run8 target account migration charges balance and has no LotFlows. Tests compare Whole-specific lot deltas across the two actually executed registrations, not fictitious identical historical lots.
- Source transfer trace LastInbound is a recipient address; target's existing transfer trace records the native transaction hash. Whole uses its distinct member hash in that existing target rule.
- Source selects the next validator through its source-ledger schedule; target uses the first active migration validator as its existing fee recipient. The source-comparison test uses the default single validator. Multi-validator fee routing is not claimed equivalent by this candidate.

## Tests supplied, not locally executed

Eight genuine-signature tests are added:

1. `TestABCIWholePartialExecutionMatchesSourceAndProposalIsolation`: source SubmitPQBatch comparison; successful, balance-failed, successful next nonce, nonce-failed members; CheckTx/PrepareProposal/ProcessProposal isolation; actual result identities; one shared proof; exact fees/amount-only lot deltas; Commit/query/restart and replay denial.
2. `TestABCIWholeRejectsEitherSignatureRootsAndNoAdmissionAtomically`: each broken signature branch, reordered complete messages, all-rejected response with no state, and a following valid proposal candidate.
3. `TestABCIWholeCandidateRollbackAndTransferOverflow`: a failed member with partially moved lots, a later valid member, caller-state isolation, recipient/fee/lot overflows and recipient==fee recipient.
4. `TestABCIWholeCanonicalEnvelopeAndTypeSpecificBound`: strict canonical transport and separate ordinary/Whole bounds.
5. `TestABCIWholeAuthenticActionIsRejectedWithoutClassicFallback`: genuine unsupported stake message rejected; following genuine transfer succeeds; two signature checks for one complete Whole and no per-member certificate re-verification.
6. `TestABCIWholeHistoryProofEffectsAndAppendOnlyCoverage`: tampered proof/hash/height, omitted/duplicated/reordered references, injected unsigned metadata, missing/forged receipts/fees, rejected-index receipt, wrong result count, nonce rollback, immutable rejection outcomes and deep-copy proof isolation.
7. `TestABCIWholeRevocationKeepsHistoryAndRejectsCurrentOwner`: real terminal revocation after a Whole, original-height validation/restart, current rejection and per-member trust refresh.
8. `TestABCIWholeSourceMigrationNeverRetriesRejectedIndices`: a real partially executed source Whole, full migration import, a later nonce that would make the rejected member executable, replay denial and original source query.

Root's focused command, in the production source tree (not executed locally):

```sh
go test ./internal/consensus -run '^TestABCIWhole' -count=1
```

Then the existing full consensus suite with its normal two pinned-contract build prerequisites, plus chain/API compatibility in the remote workflow. Source tests are not PASS evidence until that run completes.

## Remaining gates

The direct ABCI source support does not make an 8 MiB Whole reachable through today's Comet defaults or gateway. Mempool/P2P/RPC/body/proposal/response bounds and the gateway's classic-only routes, GET hex expansion, and one-envelope block mapper still require their independent transport slice. No gateway or network config file was changed here.

This first correctness implementation clones all mutable transfer branches per member and scans historical receipt coverage. It is not a throughput result or a production performance claim. Benchmark the fixed candidate separately; optimize clone/lookup costs only with the same atomicity and proof-coverage counterexamples retained.

Nontransfer PQ Actions remain fail closed in this target. Their canonical native fee/resource/lot/idempotency semantics, pure history helper split, explicit target execution and contract Action codec remain the staged work described by the design plan. Validator proposal/vote/Commit/light-client fork integration is independent of this transaction implementation.
