# Lossless mempool transport functional experiment

The codec/channel remains default off. This package supplies source tests only;
production/primary activation, throughput, physical before/after results and any
claimed saving remain HOLD.

`TestLosslessHexActualApplicationLifecycleAndCold` uses Core's existing
`consensus.NewPQLabWorkloadSource({Transfers:3,BatchSize:1})`, not a copied
fixture, BaseApplication, signature stub or independent ledger. That source
generates/destroys its temporary account and dual PQ keys internally, mines its
original source migration, and supplies three genuine N=1 original transactions
plus independent bad-A and bad-B signature controls. Only public originals are
written. Temporary validator keys are used solely through Core's normal public
`BindConsensusValidatorKeys`; their private bytes are cleared, never persisted.

The function compares an unchanged original-C arm against an owned restored-C
arm using normal `NewPersistentApplication`. Each valid block calls real
CheckTx, PrepareProposal, ProcessProposal, FinalizeBlock and Commit. Check,
Prepare, Process and pending Finalize must leave the entire committed public
snapshot unchanged. Complete responses, complete `/state` bytes and typed state,
Info coordinates, balances, nonce and application hashes must agree between
arms. No query fields are discarded. Application-local verification caches are
not part of the public `/state` endpoint; this test does not inspect or rewrite
them. The initial uninitialized Application truthfully exposes migration state
through Query while Info still has zero committed height/hash.

Bad-A and bad-B controls run while their nonce is otherwise lawful. Their real
CheckTx and proposal rejection must retain the original dual-signature failure,
not a later nonce rejection. An intentionally adversarial direct Finalize call
also checks Core's last defense and normal Commit/reload of its rejected result;
normal Comet would never finalize that rejected proposal. These calls do not
claim a BFT decision, consensus finality or authorized production execution.

The corrupt-frame control calls the actual experimental mempool Reactor and
LocalClient against the real Application. A transparent call counter delegates
CheckTx unchanged. Bad carrier frames must cause zero real CheckTx calls and
zero insertions; a valid carrier must deliver exact original C to genuine Core
CheckTx. The peer fixture supplies capability metadata only. This is a carrier
functional test, not a measured peer handshake, MConnection hop or physical P2P
test. Packed frame bytes themselves must remain invalid at the normal Core C
entry; integrity metadata cannot replace original business/AND validation.

After every successful Commit the test calls normal `NewPersistentApplication`
on that arm's persisted path and compares the whole state again. Application
has no Close API and holds no long-lived persistence handle. This is a fresh
Application constructor/load with its original validation, **not a new process,
process crash recovery, or a claim of cold CPU/crypto cache performance**.

## Sole Core CI execution

The main function and its state helper require the explicit build tag
`transportlab_actual`. Ordinary `go test ./...` does not compile or execute this
real-signature case or require its artifact root. The existing codec-only entry
remains available with no tag.

Functional/crypto execution belongs to the original Core CI owner. The LINK
implementation step performs only compile (`-run '^$'`) and scoped vet. It does
not locally run the function, an old green suite, nodes, load or benchmarks.

The test requires an explicit existing, canonical, owner-controlled artifact
root via `YNX_NETWORK_NEXT_ARTIFACT_ROOT`; missing input is a test failure, never
a skip. The owner must use the authorized artifact area:

`/Volumes/西部数据/YNX-large-work/coordination-v5-20261031/shared/LINK/network-next/`

The sole CI runner must supply its owned artifact mapping and preserve the run
directory back into that area. There is no implicit system-temp or endpoint
fallback. Use a fresh run-specific TMPDIR/GOTMPDIR under the same artifact root
and preserve actual `go test` stdout/stderr there. Example intended CI command
(not a record that it has run):

```sh
GOMAXPROCS=2 go test -mod=readonly -p 1 -tags=transportlab_actual ./internal/transportlab \
  -run '^TestLosslessHexActualApplicationLifecycleAndCold$' -count=1 -v -timeout=5m
```

The function creates a fresh `application-lossless-*` directory with exclusive
public corpus, bound migration, per-commit/reload complete state and
`actual-steps.jsonl`. It never overwrites or removes a previous run, failed state
or UNKNOWN artifact. Trace records contain public coordinates/hashes and actual
codes, not keys or invented receipts. A local compile is not functional success;
the real CI log and resulting artifacts must qualify the exact final source pin.

## Live counter input for the original normal window

`mempool.(*Reactor).LiveWireObservation() mempool.LiveWireObservation` reads
bounded detached DATA from the actual running reactor. It attaches no observer,
enables no carrier and resets no counters. The normal Core producer still owns
the original pre-start `SetWireObserver` call. Core's existing private operator
producer obtains the actual `node.MempoolReactor().(*mempool.Reactor)` and calls
this method while the node remains live; the normal command/permissions remain
Core-owned. An after-stop lifetime snapshot cannot substitute for either live
window endpoint. No public RPC or new socket collector is part of this API.

The envelope schema is `YNX-MEMPOOL-LIVE-WIRE-OBSERVATION/v1`. Producer PID,
private reactor/observer lifetime IDs, lifecycle generation and kernel
`CLOCK_MONOTONIC` nanoseconds use decimal strings. The original wire and
lossless snapshot schemas retain their original numeric formats. Capture is
non-atomic, includes only completed named calls, excludes in-flight calls, and
qualifies only its endpoints. IDs are DATA, not authority; the original normal
supervisor must independently bind its process start/source/window identity.

Wire absent, pre-start/stopped, writer-lock busy, overflow, clock failure or a
stop crossing capture is UNKNOWN with a reason and `complete:false`. Available
raw snapshots may remain attached as incomplete evidence. An unenabled lossless
carrier remains `null/DISABLED`; no missing value becomes measured zero. The
proto field stays `null/UNKNOWN`: this callee does not infer actual serialized
queue bytes from original-C protobuf sizes, frame lengths or transaction counts.
Actual owned-node metrics require the separate original raw metrics capture.

Perf's existing hook can wrap the Core producer's raw JSON with the pure
`original_live_node_capture(node, raw, sha256, start_monotonic_ns,
end_monotonic_ns)` keyword API in `scripts/loadtest/network-layer-accounting.py`.
The `node` is its original `{name,pid,startTicks}` receipt; all clock bounds must
be the same kernel `CLOCK_MONOTONIC` domain. `account_layers` binds both raw
hashes, enclosing read bounds, original PID/start, reactor/observer lifetime and
generation, and refuses stale snapshots, changed material or mixed live and
after-stop endpoints. This helper performs no read, network call or authority
check, and cannot establish a producer from a JSON PID. Retain the original raw
capture and private operator/process binding in the existing supervisor receipt.

The new counter tests use the existing BaseApplication carrier fixture solely
to observe actual reactor counter calls. They do not repeat or replace the
separate real PQ/AND Application test. Core owns the minimal normal command
call site; Perf owns the existing hook and sole actual measurement window.
Until that window runs, physical bytes, gains, pressure and sustained TPS remain
unmeasured; the carrier remains default off.

## Finite experimental peer budget

The same default-off carrier now has an immutable connection budget in addition
to its original single-frame and per-codec-call limits. Only explicit experimental
enable initializes a fixed-size private state in the existing peer storage.
InitPeer does not reset that state; RemovePeer closes that connection's state.
A new connection owns a separate state. No global peer map is added and the
original Switch connection limits remain unchanged.

Zero-valued experimental limits select finite defaults: 64 MiB cumulative peer
resource bytes, 30 seconds from first experimental use, three total send attempts
per selected frame, and two seconds per pending experimental send. Explicit
limits are bounded (peer bytes at most 1 GiB, peer duration 1 ms to five minutes,
one to sixteen send attempts, send duration 1 ms to thirty seconds). Budget clocks
reject backwards time and expiration. Bytes are reserved without overflow and
never refunded on failure. Pack reserves original plus frame size before frame
allocation; receive validates fixed header dimensions and reserves frame plus
restored size before allocating the restored C. Each queue attempt, including
queue-false, charges frame bytes again. These debits are resource limits, never
physical-byte or saving measurements.

The experimental branch uses the original nonblocking TrySend queue API with
finite attempts and a Quit-aware elapsed deadline. It retains one selected
envelope. Exhaustion terminates that experimental send, retaining the original
mempool transaction and without raw replay, next-transaction progress or queued
success. Local exhaustion does not disconnect the peer or ask Switch to redial;
other channels remain live. A later frame refused by that local resource budget
is also dropped without asking Switch to redial; malformed/unnegotiated frames
retain their original peer-error handling. These are connection-local budgets, not a global
limit across independently initiated future connections. Pack errors are
terminal, including local work/length failures; they never downgrade to raw.
The original legacy Send path is unchanged. Noneligible original
formats still select their original carrier before any send. Peer capability,
canonical bytes/ID, original validators, AND, commitments and PartSet do not
change. This isolated source delta does not enable the carrier or start a node,
measurement window, business load, public activation or a new collector.
