# Asynchronous native resource sampling

The failed `window-1ZsLDk` comparison stopped on the original 1,500 ms native
probe timeout. It is not a completed throughput comparison. The synchronous
`spawnSync` call also blocked the launcher's event loop while waiting, delaying
signal, deadline and child-exit handling. This change addresses that control
problem; it does not establish the syscall responsible for the original timeout
or attribute host process churn to any product.

The current source launcher uses an asynchronous, single-flight native probe.
It retains the existing actual kernel probe binary, 1,500 ms deadline, 1 MiB
combined output bound and all workload/resource caps. There is no fallback RSS
estimate or retry after a failed sample. Timeout, spawn failure, excess output,
invalid JSON, unreadable launcher or failed resource checks remain fatal.
Each probe owns a detached process group; timeout/cancellation kills that group.
Shutdown cancels and awaits the original probe. The schema-4 receipt includes
probe PID, raw diagnostic prefixes, elapsed time, terminal status and group
clearance, and requires probe clearance for `allGroupsGone`.

While a probe runs, subsequent sampling ticks skip it instead of overlapping.
The launcher can continue handling its existing active deadline, child exits and
signals. A probe result arriving after its deadline is rejected even if its
termination callback runs late. Full successful stdout is separately bounded
for JSON parsing; receipt diagnostics retain only 64 KiB per stream.

Validation on macOS arm64 / Node, no network nodes or load launched:

```
node --test scripts/loadtest/native-resource-probe.test.mjs scripts/loadtest/consensus-local-window.test.mjs
node --check scripts/loadtest/consensus-local-window.mjs
git diff --check
```

Six tests passed: successful terminal identity, hung-probe responsiveness and
no overlap, cancellation/reaping, spawn failure/output flood, complete JSON
above the diagnostic prefix limit, and unchanged prepare-only resource plans.
This is synthetic controller validation, not a new four-node acceptance run.
The immutable old frozen runner and binaries remain unchanged. Future freezes
must include `native-resource-probe.mjs` alongside the launcher, with both hashes.
A fresh Root grant is required for another network comparison. Original UNKNOWN
transactions remain retired and must only be reconciled read-only.
