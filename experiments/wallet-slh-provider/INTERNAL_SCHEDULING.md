# Guarded original SLH scheduling experiment

The read-only PERF `BASELINE_SCOPE_READY.json` has
`scopes.walletInternalSLH.baselineReady=true`; NativeRuntime and stable-chain
scopes are false. The d2442feea593073815290518f404583feb4f4851 baseline and its
11,000 raw samples are retained without rerunning or overwriting them.
The unified YNX execution policy and original WALLET packet apply.

`fork/slhdsa` copies CIRCL v1.6.5 maintained source verbatim, including its license;
only the new `scheduling_experiment.go` adds scheduling. Upstream non-test source
files are unchanged; one external test import is renamed to this fork namespace. The isolated module's path is under the upstream namespace
so it can reuse the pinned original internal hash/encoding helpers without
copying or replacing them. Both original and fork providers coexist in one test
process and cross-verify signatures. Copied upstream tests are retained as source;
their complete 37 MiB testdata corpus is not duplicated. Run the explicitly named
new lab tests, not the upstream full test inventory without its separate corpus.

The root go.mod/sum are untouched. Normal no-tag builds call a thin function
that delegates straight to original CIRCL SignRandomized with original entropy,
message and nil context. The experiment requires BOTH the `ynxslhexperiment` tag
and `slh-experiment.mod`; the latter adds only the isolated fork module. Under
that tag the adapter rejects every key unless a private test-only helper has
registered a synthetic key. Application binaries have no registration function.
No real account, Native input or production key is admitted. Synthetic adapter
material is copied only in process, outside timing, with transient encoding
cleared and the fork key cleared after all joined callers. No private artifact
is written. This is not physical-erasure or side-channel evidence.

The original BatchSign privateKeyState mutex remains held through every helper,
worker join, buffer cleanup and panic propagation. Fork signing obtains original
randomized R once, with the upstream readRandom/message framing/PRF/hash parse.
It never selects another R, message leaf or future message. FORS tree indices
are parsed once in original order; fixed odd/even trees occupy disjoint original
signature positions. Each XMSS layer schedules only its largest known
non-selected-leaf authentication subtree against the caller's other paths and
current WOTS signature. Original xmssPkFromSig still reconstructs the root before
the next layer receives a message. The 17 dependent layer messages are not
parallel independent signatures.

One process-wide nonblocking token pool permits at most min(4,GOMAXPROCS-1)
extra workers. At this experiment's GOMAXPROCS=2 that is one extra worker. If
another signing request is active when acquiring, the request uses original
serial signing. No token wait occurs, and nested acquisitions do not exist.
An admitted worker is private to one signature and owns separate original
statePriv/hash/address/stack scratch. Jobs use private address copies and fixed
disjoint output slices. Both sides are joined before rethrowing either panic;
worker scratch clears before the token is released and before key unlock.
Independent demand arriving after admission cannot preempt an already-running
worker; the gate prevents additional inner admission while requests overlap.

The correctness suite uses explicitly public synthetic seed bytes 0..95 and
32-byte additional randomness per message, compares all signature bytes with
original CIRCL, verifies both ways, and rejects tampering. This is distinct from
the randomized-key/R performance sampling design; d244 is not byte-replayable.
Additional checks cover entropy failure/no partial output, synthetic enrollment,
protected concurrent callers/Destroy, global bounds/fallback, and both caller
and worker panic join/scratch clearing. A race run is a concurrency diagnostic,
not proof of constant time or side-channel safety. No energy, hardware erasure,
Native authorization, release or chain-finality measurement is claimed.

After sampling uses the same seven scenarios, two warmups/caller, 1,000 random
signatures/caller, 256-byte N=1 inputs, context, original random Reader, M4,
Go1.26.10, GOMAXPROCS2, CPU-profile timing, verification-after-window and raw
nearest-rank method as d244. Additional synthetic registration is outside the
window. The backend field explicitly labels the scheduled fork. Before/after
measurements are separate profiled desktop runs with background activity, not
randomized controlled trials or evidence of a deployment benefit.

Independent verification also uses the already-installed, read-only Noble
`@noble/post-quantum@0.6.1` implementation, via Node24 and
`verify-independent.mjs`. Eight publicly seeded key/R cases verify original and
scheduled signatures, reproduce byte-identical signatures in Noble, and reject
tampering. Its input artifact contains only public keys, messages, public test
additional randomness and public signatures; no private key/backup is exported.

## Measured after, retained counterexamples

The formal Go sampler passed all seven scenarios and all 11,000 full original
verification checks, tamper refusals and destroyed-handle refusals. Each JSON's
raw latencies, counts, nearest-rank quantiles and throughput were independently
recomputed by `compare-results.mjs`, with matched before N=11,000 and after
N=11,000. Every after pool snapshot has Requests=Workers=0 and PeakWorkers<=1;
caller goroutine counts match before/after join.

| Caller / keys | N | P95 before -> after ms | P99 before -> after ms | ops/s before -> after |
| --- | ---: | ---: | ---: | ---: |
| SLH 1 independent | 1000 | 22.259 -> 15.402 | 32.493 -> 17.341 | 48.563 -> 78.598 |
| Sequential batch 1 independent | 1000 | 27.544 -> 13.367 | 42.191 -> 19.892 | 45.453 -> 81.808 |
| Existing pair 1 independent | 1000 | 22.669 -> 24.457 | 30.796 -> 50.359 | 46.765 -> 69.421 |
| SLH 2 independent | 2000 | 23.384 -> 27.977 | 26.210 -> 33.491 | 92.415 -> 84.806 |
| Sequential batch 2 independent | 2000 | 23.181 -> 32.446 | 25.699 -> 61.050 | 91.705 -> 82.219 |
| Existing pair 2 independent | 2000 | 22.672 -> 23.052 | 24.226 -> 28.106 | 92.903 -> 91.308 |
| Existing pair 2 shared | 2000 | 67.334 -> 37.203 | 76.559 -> 43.885 | 46.555 -> 82.602 |

Single SLH process CPU use rises from 0.987 to 1.781 cores, and allocated bytes/op
from 74,119 to 85,584. Shared-key pair use rises from 1.006 to 1.830 cores and
244,654 to 256,029 allocated bytes/op. Full after invocation peak RSS is
274,235,392 bytes versus before 272,793,600; these include tooling/verification,
not just signer windows. The before/after CPU seconds, mallocs and per-caller
P95 are available in the public independently computed comparison JSON.

This is mixed evidence, not an across-load performance win. Single signing and
shared-key serialized demand improved in this observed run; independent demand
lost throughput, and the existing pair single-caller P99 got worse. Midrun
Xprotect (~145% CPU), a Codex renderer (~102%) and UI work were present; these
are recorded without suppressing system work or selecting better samples.
Causal attribution and constant-time/side-channel/energy/hardware-erasure safety
remain unproved. The original default backend is retained; production activation,
Native/Keychain/device approval and chain finality remain outside this delivery.

The Go sampler/test subprocess exited 0 and wrote complete JSON/profile/cleanup,
but the original outer wrapper exited 1 after sampling. The operator edited the
shell source while it was waiting for its child, shifting its read offset; it
then attempted the truncated path `der/run-baseline.sh`. The first cause is
retained at `results/wrapper-postrun-first-cause.txt`. This is not reported as a
successful complete runner invocation. No 11,000-sample rerun or overwrite hides
it. The fixed runner snapshots BOTH shell scripts into a private read-only
external directory and execs the copied wrapper before starting work. Its syntax,
copy hashes and existing-result refusal were validated without new signing.
An initial independent-verifier launch preceded its public JSON export and
failed ENOENT; the original failed log is retained, followed by a successful
launch after the Go exporter completed. No fixture or result was fabricated.

Artifacts are under
`/Volumes/西部数据/YNX-large-work/wallet-slh-scheduling-experiment-20261031`;
before remains separately under `wallet-slh-original-baseline-20261031`.
The experiment remains an uncommitted candidate for parent/Core integration.
