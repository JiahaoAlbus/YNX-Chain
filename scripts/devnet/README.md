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

The real four-process PQ **ceremony** entry consumes CORE helper commit
`56f04dae0059db75598a42de38f44d4dec434ce0` or a descendant, with its original
normal node source. CORE must retain that ancestor in the CI checkout history:

```sh
python3 -B -m unittest discover -s scripts/loadtest -p test_pq_normal_process_lab.py -v
python3 -B scripts/loadtest/pq-normal-process-lab.py \
  --source "$GITHUB_WORKSPACE" --commit "$GITHUB_SHA" --execute
```

Use another dedicated hosted source job with the same resource admission and
limits as above; run the current-owner diagnostic baseline first. Upload only
`$RUNNER_TEMP/pq-normal-process-*/public/` on success or failure. It builds the
original helper/node, starts four normal bootstrap processes, obtains each
validator registration once at the actual common next height, posts its exact
ABCI bytes once and observes only the same hash thereafter. It uses the normal
future height-halt publisher, waits for all four original nodes to exit, invokes
activation once and resumes their exact Home/HRS/args with an inherited private
FD mapped to 3. No credential bytes enter argv, environment or public artifacts.
Current AppHash is compared with original ABCI Info; Comet status's latest header
AppHash is the previous application boundary and is not substituted.

This entry deliberately **does not qualify finality or measure a load window**.
It retains RPC execution/automatic-successor observations, ACK/UNKNOWN, original
hashes, monotonic observation points, actual process/resource data and explicit
registration/preparation/functional traffic counts. The corpus currently has
one source owner. Completing this ceremony is neither a many-account benchmark
nor proof of dual-PQ quorum. CORE still needs the normal stopped BlockStore/App
export of independent pinned proof materials and original H/H+1 transaction
proof, then the existing `proof-context` and verifier CLI. Do not manufacture a
trusted light block from these RPC responses. Private original files remain in
this job for that normal exporter; never upload/clone custody or repeat the
registration/activation ceremony after UNKNOWN.

