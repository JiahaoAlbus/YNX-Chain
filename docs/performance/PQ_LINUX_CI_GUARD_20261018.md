# Linux fixed-case CI guard source

No existing macOS native/four-node guard can be claimed as a Linux implementation. The original performance owner supplies scripts/loadtest/pq-paired-linux-window.py plus test_pq_paired_linux_window.py for the already-authorized remote N1/trial1 paired case. Protocol owns CI integration and dispatch. This performance thread starts no Go, CI, node or network workload.

The frozen69e788b4 candidate contains the original success helper and exact BatchSign/Extract/fixture ABI used by the overlay. The guard accepts only the prepared command for TestPQPairedPersistentPerformance, N1/trial1 and GOMAXPROCS1/GOGC50/GOMEMLIMIT512MiB. Source must be exact and clean before/after; frozen overlay/source/dependency pins are checked. Case output and guard receipt live outside checkout; business fixtures use case/tmp, while Go compiler scratch uses case.build/tmp.

Prepare the one case without starting Go:

    node scripts/loadtest/prepare-pq-paired-benchmark.mjs --source-root "$GITHUB_WORKSPACE" --commit ACTUAL_FULL_CHECKOUT_SHA --output-dir "$RUNNER_TEMP/pq-n1-trial1" --n 1 --trial 1 --write

Then the single Root-authorized CI step may invoke:

    python3 PATH/pq-paired-linux-window.py --prepared "$RUNNER_TEMP/pq-n1-trial1/prepared.json" --receipt "$RUNNER_TEMP/pq-n1-trial1-guard.json" --execute

Default invocation is prepare-only. Linux Python3 standard library is sufficient; no sudo or dependency installation. The runner must expose readable procfs without hidepid, owned smaps_rollup and private subreaper/fork support. The source uses procfs directly during monitoring, not ps forks. Owned scope follows real parent/adopted-child closure plus recorded PID/startTicks, excluding shared ancestors. A copied numeric PID/PGID never establishes ownership. The observed Go birth identity must remain consistent. Unknown/unreadable active data stops the job. Cleanup signals only fresh owned identities, reaps adopted zombies and requires two empty-owned scans.

Bounds:105s active+at most15s cleanup inside120s total, sampled owned RSS1GiB including wrapper,320 threads/16 live identities,32MiB private case data,1GiB compiler scratch,1MiB logs. Admission requires disk1GiB floor+425MiB reserve+1GiB compile estimate+32MiB case reserve; runtime preserves floor+425MiB. Source/temp/home/cache filesystems must match. Linux MemAvailable must cover1GiB+128MiB; it is not macOS dispatch pressure.

[Linux kernel documentation](https://www.kernel.org/doc/html/latest/filesystems/proc.html) notes ordinary RSS counters may be asynchronous; this source reads smaps_rollup rather than substituting statm/free pages. Measurements are sampled, not a hard cgroup limit or atomic host view. No transient peak guarantee is claimed. The actual first Linux run must validate procfs permissions, subreaper, fork, memory/disk admission and cleanup before any successful benchmark interpretation.

Ten pure Python controls passed on this macOS host after a real failing PID/PGID-reuse counterexample. They cover stat parsing, scope, reused identity, adopted descendants, missing roots, smaps rows, budgets, exact recipe and file type refusal. Default prepare-only exited0 and correctly reported Linux supported=false here. No Linux runtime/Go PASS is claimed. [Frozen source paths, hashes, exact support conditions and remaining qualification](evidence/pq-linux-guard-handoff-20261018.json).

The workflow should upload the small summary and guard receipt even on failure, while retaining original QA snapshots privately on the runner; no wildcard snapshot publishing is supplied. Go exit0 alone or skipped tests cannot qualify: matching new paired result, source identity and completed cleanup are also required. No auto retry, expanded N or BFT-finality claim.
