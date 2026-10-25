# Per-account ready sender scheduling

The prior repeated driver waited for every sender in a round before signing
any sender's next nonce. A slow account therefore stalled all peers and made
configured per-round offer rates unsuitable as continuous offered-load claims.
`-sender-mode ready-pool` now removes that whole-round barrier. The default
`rounds` mode remains available for the retained comparisons.

The ready controller owns account advancement. Each account has one reserved
or in-flight transaction; only its own identity-bound ACK, code-zero execution,
weighted quorum, Merkle proof, durable fee/nonce verification and published Info
gate permit the next nonce to be signed. UNKNOWN/rejected/failed/timed-out or
otherwise unverified accounts are permanently quarantined for this run, while
other accounts continue. There is no resubmission/resume path. The existing
exclusive durable fixture claim is retained after completion, error or crash.

Ready waves contain at most 64 signed envelopes. Before dispatch, an exclusive
0600 `sender-ready.signed.jsonl` file binds manifest SHA, migration and genesis;
creation Syncs the file and directory. Each wave appends complete public signed
inputs with sender/index/nonce-cycle/hash identity and file-Syncs before any
member is offered. The shared entry already exists durably, so each wave does
not create another file/directory entry. A short write, write error or Sync
error poisons the writer. No member of that failed wave is dispatched; existing
bytes are preserved for reconciliation, never automatically retried.

Submission uses the existing maximum four workers; observation uses maximum
four grouped workers. Only the observation owner writes an accepted result;
a terminal channel transfers it back to the controller before signing that
account's successor. Pending-submit and pending-observe peaks are measured.
Offers obey a global maximum pace and never create catch-up bursts after an
account wait. Full-window timing includes signing, journal Sync, readiness waits
and observation/drain. An insufficient ready-account pool underfills the target
rate and must be reported as such, not relabeled as achieving configured load.

Cancellation closes/drains the submission pipeline before waiting for canceled
observers; observers need their accepted queues closed to finish draining.
An isolated Go-overlay RED counterexample omitting that close fails with
`controller and canceled observers waited on each other`. The repaired test
passes. No production source was replaced for this RED run.

The read-only decoder checks bound header identity, exact initial signed bytes,
every signature, template/fee/nonce, sender/index mapping, per-account ordering
and duplicates. Only newline-complete records identify possible submissions;
an incomplete final line is retained as an explicit partial tail. Complete bad
records fail closed. This returns identities, never successful ACKs or a retry
queue. A clean stopped-network verification requires complete coverage and no
partial tail. The stopped replay supports the new journal as well as old round
files; actual ready-pool network/stopped replay has not yet been performed.

## Source evidence

- Real signed application test: three senders × two nonce cycles, six successful
  native executions/Commits, durable restart, fee count six, every sender nonce
  two and balance 9,996. A fast sender's nonce two is submitted while a slow
  peer's nonce one is still awaiting observation. Quorum flags in this unit test
  are explicit gate fixtures; this is not multi-node consensus evidence.
- UNKNOWN, CheckTx rejection, incomplete finality and journal publication lag
  each quarantine only that sender; peers complete two cycles. No later signed
  envelope is produced for the quarantined account.
- Short/write/Sync fault cases reject the wave and a second append without
  performing another write. Readback rejects wrong binding, duplicate index,
  bad hash/signature, nonce gaps and unknown JSON fields; partial tails and
  cancellation return no invented identity.
- A real child calls `os.Exit(17)` at the first submission callback boundary.
  The complete initial public envelopes and durable claim survive; read-only
  recovery leaves original bytes unchanged and fixture reuse is rejected.
  This is input-journal abrupt-exit coverage, not a node/network crash drill.

Final client package PASS 2.546 s; ready/grouped/paced race PASS 3.365 s; runner
prepare-only tests PASS 802.117 ms. Raw logs, RED result and exact source hashes
are in [the evidence JSON](evidence/ready-sender-source-20261017.json).

```sh
GOMAXPROCS=1 nice -n 10 go test -p 1 ./cmd/ynx-consensus-perf-client \
  -count=1 -v -timeout=45s
GOMAXPROCS=1 nice -n 10 go test -race -p 1 ./cmd/ynx-consensus-perf-client \
  -run 'TestReady|TestGrouped|TestPaced' -count=1 -timeout=45s
node --test scripts/loadtest/consensus-local-window.test.mjs
```

CLI and runner accept the new mode only with paced submission, at least two
nonce cycles and a new durable result destination. Schema 9 records sender
mode, prepared/offered/completed/quarantined accounts, peak in-flight accounts,
completed full nonce-cycle prefixes and queue peaks. Steady/interior TPS remains
unqualified for this bounded source stage.

All existing caps remain: total at most 2,048 transactions, at most 32 cycles,
client timeout at most 30 s (scheduled runner still 10 s), runner 45+15 s,
1 GiB RSS, 32 MiB data and original child/thread/port/disk limits. This finite
driver cannot itself qualify ten minutes at 1,000 TPS. Longer streaming metrics,
bounded account recycling beyond this finite plan and readback/history growth
need explicit implementation and a separately scheduled resource plan.

The prior grouped network smoke proved actual batching but exposed 600 Tx
queries for 64 transactions. Next combine per-block inclusion discovery with
the ready sender path, measure its operation counts, then request one meaningful
larger comparison window from Root rather than repeating 64 transactions for
every small source change. No additional network run is authorized by this doc.
