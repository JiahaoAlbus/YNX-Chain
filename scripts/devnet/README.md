# devnet

This directory is part of the YNX Chain engineering surface. It is intentionally separated so runtime code, deployment assets, and review packages do not collapse into the website repository.

The source-only Linux normal-node cohort entry is
`scripts/loadtest/consensus-linux-cohort.py`. CORE owns intake into the original
workflow; PERF owns this harness. Run it in a dedicated GitHub hosted Linux job
after checkout and the candidate's normal Go/Node setup. Do not overlap builds
or other heavy commands in that job. The harness compiles the three normal
commands sequentially, then runs four `ynx-comet` processes with their original
in-process applications and independent genesis/migration pins.

```sh
python3 -B -m unittest discover -s scripts/loadtest -p test_consensus_linux_cohort.py -v
python3 -B scripts/loadtest/consensus-linux-cohort.py \
  --source "$GITHUB_WORKSPACE" --commit "$GITHUB_SHA" \
  --work-parent "$RUNNER_TEMP" --profile legacy-native --execute
```

Upload only `$RUNNER_TEMP/normal-cohort-*/public/` with the workflow's normal
`if: always()` artifact step, including when the command fails. Never upload
`.private/`: it contains disposable synthetic validator/sender keys, signing
state, node data and operation-local module/build caches. The receipt records
the source/fork tree, compiled binary digests, four PIDs, full planned cohort,
original client and readback outputs, sampled resources, process durations and
owned-process cleanup. Initial gates are actual Linux MemAvailable >=6GiB,
disk >=16GiB and no other observed heavy process. Limits are two CPU affinity
slots, sampled 4GiB owned RSS, sampled 8GiB new allocated data and 900 seconds
including cleanup; the original client remains bounded to 2048 requests/30s.

`legacy-native` is an explicit prerequisite profile: fresh smoke (8 requests)
and fixed-window cohort (128 requests) use independent synthetic networks.
They do not measure PQ consensus, physical Commit timestamps, authenticated
H/H+1 results, sustained capacity or four physical fault domains. Original
H/H+1 RPC material is retained as **unverified data** for the original CORE
verifier. `--profile pq-and` currently refuses before dispatch: CORE must supply
the normal fresh PQ fixture/operator inputs and compatible original client
H/H+1 verifier path. Do not substitute the in-process Go E2E or relabel the
legacy result. Commit-stage export also remains a normal node producer gap;
the harness reports actual process/operation times and original client stages.

The current-version **source baseline** is a separate opt-in path. It freezes
only the chosen owner's committed Go graph and adds entry observers through a
guarded Go overlay. It neither edits the owner checkout nor includes its
in-progress/untracked lab source. A dedicated hosted source job can run:

```sh
python3 -B scripts/loadtest/prepare-pq-baseline.py \
  --owner "$BASELINE_OWNER_CHECKOUT" --commit "$BASELINE_OWNER_SHA" \
  --output "$RUNNER_TEMP/current-baseline-source"
python3 -B scripts/loadtest/run-pq-baseline.py \
  --prepared "$RUNNER_TEMP/current-baseline-source/prepared.json" \
  --mode record --execute
```

CORE supplies the checkout at the exact declared baseline SHA; do not silently
replace it with a later integrated candidate. The first declared source is
`fdc08527514587d5756264e43ab63588791e189a`. Upload only
`$RUNNER_TEMP/pq-baseline-*/public/` on success **and failure**. The fixed matrix
uses authentic signed Whole history H=0/64/256/512, K=1/16, original CheckTx,
recheck, Prepare/ProcessProposal, FinalizeBlock, durable Commit and cold reopen.
Actual account distribution, protected Wallet online signing, engine votes,
mempool and per-hop byte counts remain `UNMEASURED` in this source-only result.
Entry counters report calls, inclusive time and exact known copied slice bytes;
unknown map/account allocator bytes are not fabricated. Parent phase time and
process allocation include diagnostic overhead; nested timers are not additive.

The first run retains its public signed input bundle. Later candidates must use
`--mode replay --input ORIGINAL_BUNDLE --input-sha256 EXACT_SHA256`, then
`compare-pq-baseline.py --before ORIGINAL_PUBLIC --after CANDIDATE_PUBLIC
--output NEW_RESULT`. This compares the **entire** committed state and exact
member results/AppHash, including fees, balances, nonce and history, without a
projection that discards differences. Source matrices never establish final
chain TPS or authorize skipping failure/competition/partition qualification.

Additional same-candidate coverage uses `run-pq-baseline.py --profile multi-whole`
with the existing `--prepared`, `--mode record|replay` and replay SHA pin. It runs
only `TestPQMultiWholeBaseline`: H0/H512 × WholeCount1/16, one member per Whole.
Record a NEW synthetic 528-Whole signed public corpus against the frozen
unoptimized source, then replay those exact bytes on the candidate. The original
512-history/eight-case corpus and receipt remain unchanged. Each phase uses the
same candidate order/height/time; complete CheckTx/recheck responses, full
Finalize response, member outcomes, after-state and cold restart are retained.
Original CheckTx sees committed state, so later nonces can have rejected members
there while the sequential candidate admits them; compare both original results,
never invent a cumulative mempool state or count rejected members as business.
The explicit Commit diagnostic includes all validation phase durations plus
hash-document/hash-encode-digest detail, with its same-attempt height and valid
flag, alongside JSON/write/fsync/rename timing. Entry observers separately expose
Finalize seal, full state validation and hash construction. Nested timings overlap.
Keep both sides on this exact diagnostic version; replay the old eight-case
decoder comparison with its original b6 tools so instrumentation is unchanged.
This is
additional source evidence; actual distribution and sustained chain remain
UNMEASURED. CORE owns the one hosted workflow intake; do not dispatch duplicates.

The real four-process PQ functional/proof entry consumes CORE helper commit
`a78803d31632a461df7f012e2c13e46f17c48e6d` or a descendant, with its original
normal node source. CORE must retain that ancestor in the CI checkout history:

```sh
python3 -B -m unittest discover -s scripts/loadtest -p test_pq_normal_process_lab.py -v
python3 -B scripts/loadtest/pq-normal-process-lab.py \
  --source "$GITHUB_WORKSPACE" --commit "$GITHUB_SHA" --mode pre-signed --execute
```

Use another dedicated hosted source job with the same resource admission and
limits as above; run the current-owner diagnostic baseline first. Upload only
`$RUNNER_TEMP/pq-normal-process-*/public/` on success or failure. It builds the
original helper/node/verifier, starts four normal bootstrap processes, obtains each
validator registration once at the actual common next height, posts its exact
ABCI bytes once and observes only the same hash thereafter. It uses the normal
future height-halt publisher, waits for all four original nodes to exit, invokes
activation once and resumes their exact Home/HRS/args with an inherited private
FD mapped to 3. No credential bytes enter argv, environment or public artifacts.
Current AppHash is compared with original ABCI Info; Comet status's latest header
AppHash is the previous application boundary and is not substituted.

Run `--mode online` in a separate fresh admitted job for the original protected
sender path. Modes are never pooled. Eight independent original synthetic owners
reserve four for preparation and four for functional transfers; each has one
outstanding operation, no batch wait and no replay of UNKNOWN. Before dispatch,
an immutable four-request plan retains the complete functional denominator.
Pre-signed requests select the exact current owner/nonce from the original
owner-major manifest. Online requests use the original credential-FD sender,
save originals once, and close functional pending operations only through its
normal independent-proof `confirm`; unresolved preparation operations remain.

After original H/H+1 observations, stop all four normal nodes, require identical
full committed-state file hashes, then invoke the original stopped-store
`export`, pinned `proof-context` and normal `ynx-consensus-proof-verify` CLI.
Qualify only successful original dual-hash transaction DATA, with nativeGrant
false. Original RPC observations are immutable and separately linked by SHA256.
Only public proof subtrees are uploaded, never custody, credentials, HRS or DBs.

The entry records parent-monotonic checkpoint wait, original sender dispatch,
broadcast round trip, all-node inclusion observation, successor availability,
stopped export, proof-context, verifier and online-confirm intervals. Dispatch
includes original CLI startup, validation and durable publication; it is not a
crypto-only timer. Inclusion is a polled upper bound, not a physical block clock.
Qualified return includes cohort completion, shutdown/export/verification and
is not continuous-load finality latency. Four successful functional proofs
cannot establish stable TPS, finality P95, byte saturation or independent fault
domains. Those four formal metrics remain UNMEASURED until the separately
scheduled same-condition sustained windows. Never repeat the ceremony after
UNKNOWN or manufacture trusted light blocks from RPC responses.

