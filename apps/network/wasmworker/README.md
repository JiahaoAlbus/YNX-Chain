# Fixed Network WASM worker

This independent Go module builds `ynx-network-task-worker`. It is a local
`CONTROLLED_SANDBOX` implementation for `public_block_histogram`, not a production
issuer, user consent, verified CPU service, reward, account state or funds proof.
The parent retains the original task authorization and independently recomputes
the histogram before issuing its controlled receipt.

The worker embeds exactly one owned 149-byte WebAssembly 1.0 module. Its SHA-256 is
`72d241c74a72b5aaf49b1799150676c30b6972fc0bd2e2beaea324bc7e7c6fa6`.
`internal/gen` constructs those bytes using deterministic binary sections;
`go generate .` regenerates them without a WAT compiler or downloaded module.
Runtime code checks that pin. No task, manifest, path or environment can select
WebAssembly bytes. The guest has no imports, host functions, WASI, start function,
file or network API. Its only exports are `memory` and `run(ptr,len)`.

The interpreter uses `WithMemoryLimitPages(129)` and
`WithCloseOnContextDone(true)`. The module declares fixed min=max 129 64-KiB pages.
Input is read directly into linear memory at offset 4096. The fixed guest counts
each original byte into 256 little-endian uint32 counters at offset 0. No JSON
parsing or number conversion modifies the original bytes. The parent supplies
public-block provenance; a histogram alone does not prove a block or transaction.
The guest independently traps pointers outside the fixed input window or a
length over 4 MiB. Calls process disjoint slices of at most 4096 bytes and accumulate
into the fresh module's zeroed count table.

Only these four numeric flags are accepted, exactly once each, in any order:

```
ynx-network-task-worker --bytes N --cpu-milli C --memory-bytes M --duration-ms D
```

- `N`: 1..4194304. Stdin must contain exactly N bytes followed by EOF. Short input,
  trailing bytes and noncanonical numbers are rejected.
- `C`: 1..1000. After each interpreter slice, the worker cooperatively waits in
  proportion to measured call time. This is a duty-cycle policy, not a hard OS
  CPU quota or attestation of CPU service. One interpreter thread is used.
- `M`: 8454144..25165824. Guest linear memory stays fixed at 8454144 bytes regardless
  of the larger admitted budget. Stdin/output use memory views without an N-byte
  host copy. This does not bound the Go/wazero host's full RSS or runtime overhead.
  The parent applies its stricter combined input/work-buffer admission separately.
- `D`: 1..5000 milliseconds. Context cancellation closes an in-flight guest. A
  process watchdog also exits at the duration deadline if a host pipe blocks.

Successful stdout is exactly 1024 raw bytes and stderr is empty. Failure emits
only one fixed code to stderr: `ARGS`, `INPUT`, `MODULE`, `EXECUTION`, `OUTPUT` or
`TIMEOUT`; exit codes are 2, 3, 4, 5, 6 or 124 respectively. No failed query emits a
completed histogram. A partial/failed stdout write must be rejected by the
parent's exact output-size and exit-status checks.

Build and test from this module with a compatible local Go toolchain. The current
verified toolchain is Go 1.26.10; the module minimum is Go 1.25.0. Set `GOTOOLCHAIN=local`,
`GOWORK=off`, and task-specific `GOMODCACHE`, `GOCACHE`, `GOTMPDIR`, `TMPDIR`, `GOPATH`
outside user data before running:

```
go mod verify
go test -mod=readonly -p 1 -run '^TestWASM' -count=1 -timeout=30s .
go build -mod=readonly -p 1 -trimpath -o /task-artifacts/bin/ynx-network-task-worker .
```

The tests execute the actual interpreter and compare its histogram with an
independent Go recomputation, including all 256 byte values and the 4 MiB boundary.
Separate test-only modules exercise an actual infinite loop under deadline and
cancellation, and a real `memory.grow` failure. These fixtures cannot enter the
normal worker. The CLI tests launch a real child, validate raw output/strict
input, and confirm a blocked stdin cannot retain the process past its deadline.
Wazero clamps a larger declared maximum to its configured memory cap; tests check
that effective cap plus rejection of an excessive initial memory.

The dependency is pinned to
[wazero v1.12.0](https://github.com/wazero/wazero/releases/tag/v1.12.0), retaining its
[official module path](https://github.com/wazero/wazero/blob/v1.12.0/go.mod).
The interpreter memory/cancellation behavior uses its
[official RuntimeConfig API](https://github.com/wazero/wazero/blob/v1.12.0/config.go).
No parent module dependencies or shared locks are changed.
