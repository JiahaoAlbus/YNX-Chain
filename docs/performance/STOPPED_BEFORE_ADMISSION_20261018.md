# Before stopped replay: admission rejected

Root granted one retained-binary offline attempt after the archive returned. Three command-plan Node tests passed with process isolation disabled (7.996ms); the actual prepare-only CLI exited 0. The first ordinary Node test runner had failed to spawn its child with EAGAIN and a subsequent shell creation failed with os35. Both are retained as prior failures, not reported as test failures of the plan or as PASS.

Fresh ps observed 917 visible processes and no selected compiler/node conflicts. The controller session 40250 nevertheless correctly rejected its real native pressure sample (dispatch2) before spawning the retained test binary. It exited 1 after 563ms; no Go compiler, fixture, node, RPC, signed workload or offline replay ran. The actual sample charged 79,822,848 owned/control bytes. The peakRSS field is zero because admission throws before the accepted-sample watermark; it is not evidence of zero memory use.

The original launcher77983, probe78473 and probe group-78473 were independently ESRCH twice at17:04:08.802Z/17:04:08.904Z. The original receipt and read-only databases are preserved. Heavy slot returned; another attempt needs fresh Root scheduling.

[Original hashes, resource sample summary and terminal status](evidence/stopped-before-admission-rejected-20261018.json). The controller adds only explicit --stopped-window selection to its existing resource policy, pins the retained binary SHA, rejects live original identities or existing output files, and clears inherited offline-window environment from ordinary focused tests. It does not compile updated recovery code.

Prepared normal entry (not an authorization to run):

    node scripts/loadtest/consensus-light-window.mjs --stopped-window artifacts/chain-network-performance/window-eEfGE7

Actual execution requires --execute and a new exclusive --output path. The used admission receipt path must never be overwritten. The two selected completed-window tests remain pending, as do the new source focused tests and matched cached network run.
