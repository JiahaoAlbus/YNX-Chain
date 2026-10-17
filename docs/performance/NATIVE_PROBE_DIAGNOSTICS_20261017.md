# Native resource probe: preserve actual refusal and enumeration semantics

The gc50 attempt started at 15:33:00.544 UTC and stopped in admission after
54 ms (outer exec terminal 1). Go never started. The original native helper
PID 76755 exited 0 but reported `forkSucceeded=false`, `available=false`,
`forkErrno=35`, with no wait error and empty stderr. Its launcher RSS plus
sampler/fork reserve was 54,755,328 bytes, not a 400 MiB memory failure.
Original shell 76329, launcher 76461 and helper 76755 were independently absent
on subsequent inspection. No Go retry, network run, host-limit change or killing
of unrelated processes occurred.

The original sample lists 4,165 positive PID entries, 1,359 readable entries
matching the current UID and 2,806 unreadable BSD records. Root's later ps sample
had 888 processes and zero zombies. Those captures differ in time and method;
neither establishes a unique root cause or authorizes declaring PID exhaustion.

## Source findings and actual changes

The old division of returned bytes by `sizeof(pid_t)` is consistent with the
[Apple libproc wrapper](https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.c).
Apple's [kernel implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/proc_info.c)
returns bytes copied, and traverses both allproc and zombproc. This source
reference explains why enumerated entries and later readable ps rows are not
interchangeable; it does not prove which entries existed on this installed
host at the earlier instant. Old evidence lacks the byte/errno detail needed
for further attribution and remains unchanged.

The source now:

- rejects invalid size queries, returned bytes greater than allocated capacity,
  and non-PID-aligned lengths before reading the buffer;
- records required/capacity/returned bytes, query/read errno and scanned slots;
- exposes non-positive and duplicate entries, readable BSD records and separate
  ESRCH/EPERM/EACCES/no-errno/other-error counts, with unique positive PID counts;
- preserves the existing legacy fields and actual fork/wait result;
- emits bounded stage timestamps to stderr around enumeration, BSD reads,
  fork and wait, so a later timeout does not erase every phase observation.

The light wrapper now retains the last attempted sample and reports the actual
fork result in its first-cause text, instead of only `native monitor unavailable`.
An incomplete host enumeration also fails closed. The 1,500 ms probe deadline,
400 MiB job RSS cap, ordinary real fork, Go vet and Go target remain unchanged.
There is no fake RSS estimate, fallback to ps counts, probe bypass or automatic
retry. The shared parent stays excluded from the owned workload cap.

## Focused controls and candidate identity

Portable C synthetic controls passed: bounded/aligned byte lengths, zero and
duplicate filtering, readable UID accounting and exact conservation of errno
categories. The native source passed `-Wall -Wextra -Werror -fsyntax-only`.
Fourteen Node controller tests passed (783.430 ms), including retaining fork
errno 35, invalid samples, process ownership, async timeout and cancellation.
These controls validate diagnostics and bounds, not recovery of host fork or
completion of any Go/network workload.

```
clang -std=c11 -Wall -Wextra -Werror -O1 \
  scripts/loadtest/process-snapshot-counts.test.c \
  -o artifacts/chain-performance-20261017/process-snapshot-counts-control
artifacts/chain-performance-20261017/process-snapshot-counts-control
node --test scripts/loadtest/native-resource-sample.test.mjs \
  scripts/loadtest/owned-process-set.test.mjs scripts/loadtest/native-resource-probe.test.mjs
```

A separate new native binary was built, not executed against the host:
`artifacts/chain-performance-20261017/ynx-consensus-perf-host-diagnostics`, SHA-256
`5aee5be7d63195434b919524dd473765ee0fbdb9d5bcca1194bad6eb8f743f7c`.
The wrapper records its exact path/SHA on an eventual scheduled execution.
Old frozen native binary SHA remains
`dfd3dea1398061a4817194582e713df6929443433d9506e119fbaa597eda9248`.
The new wrapper syntax and prepare-only checks passed; execute was not invoked.

[Original failed admission receipt, cleanup and input byte hashes](evidence/terminal-stream-light-fork-refusal-20261017.json)
are retained. Go terminal-stream regression and loadmetrics tests remain pending.
Next: use this exact candidate only in a fresh Root window, preserve any new
failure without retry, then resume result-slot reuse and bounded-stat integration.
