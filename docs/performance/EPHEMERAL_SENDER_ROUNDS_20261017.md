# Bounded sender reuse before sustained loading

The previous fixture discarded every native sender key after signing nonce 1.
The client could submit only that finite input once. It could not exercise
account reuse, observe later nonces or prepare a sustained driver.

The fixture now has explicit `-retain-ephemeral-senders` opt-in. Default behavior
still discards the keys. Opt-in writes only newly generated local test keys to
an exclusive 0600 `ephemeral-sender-secrets.json` inside the newly created
isolated fixture. The bundle binds the exact manifest SHA-256, genesis hash and
migration state hash. It is not a Wallet authority or a production key loader.

The client adds `-rounds` (default 1, at most 32). The total planned transaction
count remains at most 2,048, the overall timeout remains at most 30 seconds,
and repeated mode requires a new output report. The local window runner also
accepts rounds but retains its original 10-second client deadline, 1 GiB RSS,
32 MiB data, 45-second active plus 15-second cleanup and all process/thread/disk
limits. Count in a repeated plan means sender count; total transactions are
`count * rounds`. The default is still a single round.

The loader reads only the fixed fixture-local bundle, rejects symlinks and
non-0600 files, bounds the file to 1 MiB, checks manifest identity, canonical
keys/addresses, unique senders, actual initial signed transfers and funded
migration accounts with nonce zero. Retained sender order must match the input.
Only the fixture's one-unit transfer plus one-unit fee is accepted for reuse.

Before submission, an exclusive `sender-pool-run.claim` is file/directory
synced. It survives success, errors and crashes and is never automatically
removed. A second process cannot claim the same fixture. Each round's public
signed envelopes are exclusively written and file/directory synced to
`sender-round-NN.signed.json` before any submission in that round. A journal
error prevents all submission for the round. These files preserve the original
payload/hash for read-only reconciliation after an unknown outcome; they are
not a retry queue. Private keys never enter observations or the public journals.

The complete previous round must have matching ACK identities, code-zero
admission and execution, transaction proof, weighted quorum, and local durable
state before any next nonce is signed. Every sender has at most one in-flight
transaction. One rejection, unknown submission, timeout, failed observation,
missing proof, hash mismatch or cancellation stops the pool. Later rounds remain
explicitly unsubmitted. A completed pool also retires. No automatic nonce
guessing, retry, resume or replacement transaction is implemented.

Schema-5 reports include requested/completed rounds and each input's round.
Repeated reports retain public signed transaction bytes. Full-window rates
include signing, journal sync, finality barriers and drain. The offered rate
applies within each round; it does not claim continuous offers across barriers.
Active-offer interior TPS is withheld in repeated reports while full block
observations are retained. Stopped replay understands the public round journals
and checks signatures, initial sender/recipient/amount/fee, nonce progression
and exact report bytes before independent block/state replay.

## Validation

Apple M4, macOS arm64, Go 1.25.7, GOMAXPROCS=1, nice 10, Go `-p 1`:

```sh
go test -p 1 ./internal/consensus ./cmd/ynx-consensus-perf-client ./cmd/ynx-consensus-perf-fixture -count=1
node --test scripts/loadtest/consensus-local-window.test.mjs
```

The full consensus suite passed in 2.573 seconds. After final driver/test
changes, full client and fixture suites passed in 1.207 and 0.293 seconds;
prepare-only runner checks passed in 0.587 seconds. No network nodes started.

The new tests prove:

- Three fresh senders execute four rounds (12 actual signed native transfers),
  each through real CheckTx, FinalizeBlock, Commit and durable fee/nonce
  validation. The app is reopened after each round; the old signed transactions
  are rejected as replay and the next round's nonce is accepted.
- ACK/quorum/proof flags are explicit unit-test inputs in that test. They are
  not network consensus evidence. No TPS is calculated from this test.
- Unknown, rejected, timeout, wrong hash, missing durable/quorum evidence and
  cancellation paths sign/submit no later nonce and cannot revive the pool.
- Purpose/hash/address/key/order/permissions/symlink mutations are rejected;
  default fixtures retain no native sender keys and existing fixtures are
  never overwritten.
- A real child exits via `os.Exit(17)` after syncing the claim and first public
  journal, with no deferred cleanup. The parent recovers identical signed bytes
  and cannot reclaim the fixture. This is a driver file-recovery test, not a
  network submission/restart or power-loss claim.
- An existing public journal prevents submission and remains unchanged.
  Repeated-round block summaries do not invent continuous-offer interior TPS.
  Prepare-only plans do not execute binaries or create work directories, and
  reject excessive round counts, total counts and offering spans.

## Remaining work and scheduling

This removes the single-nonce driver limitation while keeping a bounded
regression mode. It is not the final sustained driver. A ten-minute run still
needs a streaming bounded-account pool, bounded observations/metrics, scalable
quorum/readback processing and a solution to growing full-state snapshots and
the 16 MiB durable-reader input ceiling. The current all-round barrier also
limits throughput and must not be described as continuous saturation.

The next small network validation is a fresh Root-scheduled 32 senders, two
rounds at 128 offered/s per round, under the unchanged strict window caps.
It must verify actual second-nonce inclusion, quorum, local durable state,
all-node stopped replay and cleanup. Preparation or source tests grant no
permission to execute it. Prior frozen binaries and completed windows remain
unchanged; no old permission is reused.

Source commit `038cebd98d6f287fee608b1925c80f763cc9d79f` was clean when the
new fixture/client were built separately in `network-bin-sender-rounds`.
The actual consensus import resolves to this worktree. App/core, host sampler
and CometBFT bytes remain the prior frozen inputs; no runtime core was rebuilt.
Go build metadata and source/binary hashes are separately retained without
claiming an unavailable embedded VCS stamp. Fresh build admission found
70,257,168,384 bytes free on the external workspace filesystem.

The preparation receipt is
`artifacts/chain-performance-20261017/sender-rounds-network-prepared-038cebd98.json`
(11,870 bytes), SHA-256
`5409f1c2cd2d27ff1e36b7021e0b0cc1b6cebe13bb0ac80fd9fad4c242be127b`.
Its tracked copy is [here](evidence/sender-rounds-preparation-20261017.json).
The standalone runner SHA-256 is
`4b52be69e51bb4257468c55e7663d3e5647929ce5ea8a35ca48b8121d6b9d9cc`;
new fixture/client hashes are respectively
`ee04f25ea40f0bd0f075a3a801cf9b0e216a841578e3da2fa28b244f241d35e1`
and `92f0dd462aa6f72864185dbc8773ad37fdba286c00a998e03c505a9db1d5304f`.
The plan remains prepare-only: 32 senders, two rounds, 64 total transactions,
128 offered/s per round, unchanged 1 GiB/32 MiB/45+15-second window and
10-second client deadline. No nodes or client submission processes started.
