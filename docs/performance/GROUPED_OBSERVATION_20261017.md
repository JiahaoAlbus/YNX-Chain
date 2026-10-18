# Group paced observation by node and inclusion height

The paced network client previously occupied one observation worker until one
transaction finished. A block containing several accepted inputs therefore
caused repeated Commit/Validators RPCs, weighted quorum signature verification,
full current-store hashing and published Info queries. The batch readback API
alone did not change that scheduler.

Paced mode now routes accepted results to a bounded worker by index, matching
the four-node endpoint assignment when four observers are configured. Each
worker keeps pending transactions across polls, queries missing inclusions,
and groups included results by exact node and height. A group authenticates
one signed header/validator set, verifies every member's Merkle proof, performs
one fresh durable batch read with every transaction signature and fee/nonce
check, and gates it with one published ABCI Info response. Default polling,
submit/observer worker limits and total input/byte/resource limits are unchanged.

No additional observer worker is spawned per transaction. Accepted queues and
pending inclusion evidence retain only the bounded input set, and only the
owning worker mutates each transaction result. Submission stays independent of
confirmation. UNKNOWN or rejected submissions never enter confirmation and
are never resubmitted. Round barriers/next-nonce safety are retained.

A late ACK joins a later poll and obtains fresh quorum/store/publication
evidence. This stage deliberately does not cache authenticated headers across
polls. Inclusion times are actual client observations; the common final time
is captured after the complete group's checks/Info and tested against the
context deadline before any member is marked successful. A bad proof fails
that member; an invalid shared quorum, corrupt store or publication hash fails
the affected group. Publication lag retains the group for polling. Expiration
drains accepted work as timeouts and never turns it into another submission.

Schema 8 uses `paced_submission_and_grouped_observation` and reports actual
Tx/Commit/Validators/Info queries, quorum verifications, durable batch attempts
and largest attempted batch size. These operation counts are not business TPS.
Closed-loop mode retains the existing single-transaction observer.

## Validation and remaining measurement

The offline integration fixture executes and durably commits three real signed
native transfers. It then signs the corresponding block header with the four
fixture validator keys, checks the actual transaction Merkle proofs and uses
the actual V2 state file. The grouped path performs one Commit, Validators,
durable capture and Info versus three per-transaction checks, verifies all
three native signatures and returns identical state/store digests. Current
bytes hashed fall from 14,331 to 4,777 for that three-transaction operation. RPC
responses are supplied by an in-memory test client; this is source evidence,
not network throughput or latency measurement.

Counterexamples cover forged quorum signatures, corrupted transaction proofs,
publication hash mismatch/lag, cancellation after Info, late ACKs, independent
paced submission while observation waits, endpoint worker ownership, UNKNOWN
exclusion and accepted-queue draining at cancellation. Reproduction:

```sh
GOMAXPROCS=1 nice -n 10 go test -p 1 ./cmd/ynx-consensus-perf-client \
  -count=1 -timeout=45s
GOMAXPROCS=1 nice -n 10 go test -race -p 1 ./cmd/ynx-consensus-perf-client \
  -run 'TestGrouped|TestPaced' -count=1 -timeout=45s
```

The completed `window-oJZYQJ` used frozen e3b7b4b72 with batch-size-one live
observation; it cannot prove this scheduler's benefit. A new frozen candidate
and fresh Root window are required for a same-shape network comparison, then
load/duration increases. Per-transaction inclusion RPC queries, replay on
changed journal bytes, the 16 MiB readback ceiling, round barriers and the
bounded 2,048-input driver still limit longer/higher-rate operation. Continuous
sender scheduling/history growth and ten-minute 1,000 valid final business
commits/s remain incomplete.

Final source validation passed: the full client package in 2.320 s and the
grouped/paced race checks in 2.267 s. The retained full verbose output is
`artifacts/chain-performance-20261017/grouped-observation-tests.txt`. This
change affects the load client's observation/scheduling only; no consensus
execution or on-disk format is changed by this stage.
