# Bounded load tools: independent senders up to 2,048

The existing 256-transaction ceiling prevented even a short offered-load probe
near 1,000/s. The fixture and client now share an explicit 2,048-transaction
ceiling; the launcher matches it and accepts finite offered rates up to 2,048/s.
This is a load-tool bound, not a chain protocol limit or execution permission.
Defaults remain 32 transactions and closed-loop mode. Queues remain bounded by
input count, with at most four submitters and four observers.

No security/admission gate is relaxed: all generated senders are fresh local
keys, independently funded in the isolated migration and signed with nonce 1.
Existing directories remain refused. Loopback endpoints, strict input decoding,
ACK identity, UNKNOWN/no-retry behavior, weighted quorum, Merkle inclusion and
fresh-hash durable readback remain enforced.

## Resource bounds and before/after

| Property | Previous tools | New tools |
| --- | ---: | ---: |
| transaction ceiling | 256 | 2,048 |
| offered-rate ceiling | 256/s | 2,048/s |
| launcher active/cleanup | 45s / 15s | 45s / 15s |
| client deadline in launcher | 10s | 10s |
| submit/observer workers | 4 / 4 | 4 / 4 |
| long-lived child/thread caps | 9 / 320 | 9 / 320 |

The repository launcher's resource defaults now directly match the stricter
frozen Root launcher used in successful windows: 1 GiB owned/control RSS and
32 MiB data. The older repository defaults were 2 GiB/128 MiB; no existing frozen
launcher or receipt was changed. Fresh disk admission requires 1 GiB plus the
425 MiB Root reserve and maximum data delta; active checks retain the free-disk
floor. Resource-error messages now print the configured byte ceiling instead of
the old fixed text. Previously recorded failures remain unedited.

The count ceiling does not promise that 2,048 transactions fit those resource
budgets. A data/RSS/deadline failure must still stop the run and be retained.
New execution requires a fresh Root schedule for a specific plan; preparation
never starts nodes. The same normal owned-parent-shell entry and separately
reported shared tool-service baseline remain necessary.

## Actual 1,024-sender fixture preparation

Apple M4, Go 1.25.7 darwin/arm64, `GOMAXPROCS=1`, nice 10. The explicit light
probe created a new isolated fixture with 1,024 independently signed senders,
validated its actual migration and checked every native signature, nonce=1,
amount=1, fee=1 and sender uniqueness. Actual application CheckTx accepted all
1,024 against that migration. No proposal, FinalizeBlock, Commit, node or network
started. CheckTx's discarded execution simulation is not business finality.

Final observed preparation was 222.641 ms; signature validation plus CheckTx
195.055 ms. Generated fixture files total 2,936,451 logical bytes. These timings
are preparation/admission observations, not business TPS. The raw report and
source digests are in
[the evidence JSON](evidence/bounded-workload-2048-20261017.json). The earlier
fixture run is also retained, with its original report-field wording explained.

The fixture suite passed in 0.935 seconds, client suite in 0.740 seconds. The
client test accepts exactly 2,048 decoder-only inputs and rejects one beyond it;
it separately checks rate 1,000/2,048 and nonfinite/over-ceiling rejection.
Existing signature/quorum/proof/UNKNOWN/durable-readback tests remain active.

The Node test passed in 0.368 seconds. It supplies deliberately empty executable
files, proves prepare-only plans for 512@256, 1,024@1,000 and 2,048@1,000 merely
inspect them, and verifies no work directory is created. Invalid count/rate/span
inputs are rejected. No such plan has executed as part of these tests.

## Reproduce and next qualification

```sh
env GOMAXPROCS=1 YNX_CHAIN_LARGE_FIXTURE=1 \
  YNX_CHAIN_FIXTURE_PROBE_DIR="$PWD/artifacts/chain-performance-20261017" \
  nice -n 10 go test -p 1 ./cmd/ynx-consensus-perf-fixture \
  -run '^TestLargeEphemeralFixturePreparation$' -count=1 -v -timeout=45s
env GOMAXPROCS=1 nice -n 10 go test -p 1 \
  ./cmd/ynx-consensus-perf-fixture ./cmd/ynx-consensus-perf-client -count=1 -timeout=60s
node --test scripts/loadtest/consensus-local-window.test.mjs
```

The new sparse native core still needs its separately scheduled network
regression. Larger short loads can then be scheduled in stages, preserving all
non-success counts and actual latency observations. The 10-second driver, fixed
total input count, 16 MiB snapshot-reader bound and whole-history persistence
still prevent ten-minute qualification. A streaming account/nonce driver,
grouped observation, controlled larger-history handling and a fresh long Root
window remain required for the original sustained 1,000 TPS goal.

## Independently frozen tools

Clean source `bfc41ea238f84965b458b73aed8b64efd360ad00` built separate fixture and
client executables in `network-bin-bounded2048`; the app remains the frozen
`aa121ecc1` sparse-native candidate. Host sampler and CometBFT are unchanged.
The updated launcher is copied to a separate immutable preparation path rather
than replacing any earlier frozen runner.

- Fixture SHA-256: `0cd52c2d74e32725f7a5d96a2c6b16efb44d80ebbef2f79550a7318d4471a10d`.
- Client SHA-256: `1c594098e7d78c36da54adbd8000b35b78817ecf7387fcb51695708f11d435cb`.
- Launcher SHA-256: `7e9103ec85fd337f72d1ff56701d67cb109bd8466fcc9990d5538c75032c33e5`.

Actual-binary prepare-only plans passed for 256@128, 512@256, 1,024@1,000 and
2,048@1,000. The source/build identities, exact caps and plans are retained in
[the preparation receipt](evidence/bounded2048-preparation-20261017.json), SHA-256
`4db0242660d8a8c734c761fedc98c097b8f9e0078e1b8ec69276bea2f906bfcb`.
It explicitly requires a fresh Root slot and records zero network startup. These
are build/preparation results; they establish neither resource fit at the upper
bound nor inclusion, execution or final confirmation under those plans.
