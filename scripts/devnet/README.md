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

