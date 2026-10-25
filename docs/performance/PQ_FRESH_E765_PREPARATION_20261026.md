# e765 fresh four-node executable preparation

Status: supplied input bytes verified; Linux relocation not executed; no prepared
file produced and no execution window authorized. This supersedes no historical
receipt and does not reuse the old performance checkout as protocol source.

Protocol source is `e76573c139f0265c10b93f2eb493be082daec2eb`, tree
`e5dd9ff807459a560bea7a4e100030f8c5b66605`. Normal push run `40239167157`
is completed/success, including focused-go, protocol-delivery and
proof-verifier-macos. The performance ELF remains independently pinned to 70e7.

Supply H is `/Volumes/西部数据/YNX-large-work/protocol/ci-e76573c139/four-node-inputs/FOUR_NODE_INPUTS_HANDOFF.json`,
21910 bytes, SHA256 `a7b1fb23b8180650a2b349439d3112e41e5cc1c0802c36765627575887bc3d64`.
Readback and the unmodified original preparation step are retained under
`/Volumes/西部数据/YNX-large-work/chain-performance-20261017/pq-fresh-e765-preparation/`.
The readback checks supplied metadata, ZIPs, all listed extracted files and
eleven source contracts against the actual e765 Git objects. The fresh ZIP has
exactly eleven entries matching the catalog. No supplied executable was run.

## Original entry and stop boundary

The original `.github/workflows/resource-market-ci.yml` focused-go job uses one
`ubuntu-24.04` Linux amd64 runner, full exact checkout and the original heavy
concurrency group. Step `normalci` validates an actual active dispatch against
the completed same-source normal run. Step `pqfreshprepare` (lines 1798 onward)
downloads and verifies that original artifact, relocates its four ELFs, writes
a seven-field absolute business manifest, writes the exact eleven-field
prepared file with `executionAuthorized=false`, and invokes
`validate_consensus_fresh_business_recipe(..., inherited={})`.

Its case is `$RUNNER_TEMP/ynx-pq-network-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT`,
build is that path plus `.build`, and intake is
`$RUNNER_TEMP/ynx-pq-fresh-intake-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT`.
Only the case, build, intake, normal-CI metadata and GitHub environment output
are written by preparation; source remains clean. Exact resolved paths and
actual runner identity must be recorded on that Linux runner, not predicted
from this macOS checkout. All four Comet instances belong to that one runner.

Important: there is currently **no preparation-only dispatch input**. With fresh
selected, successful `pqfreshprepare` flows into `pqnetwork`, which runs the
controller with `--execute`. Dispatching the existing workflow now would exceed
the preparation-only instruction. Do not dispatch, cancel a race after prepare,
invent current-run IDs, forge a normal-CI gate, or invoke its controller on macOS.

## One complete preparation plan for Root scheduling

1. Designate the actual Linux same-VM normal caller and approved preparation
   stop boundary. The existing hosted job is ephemeral: its absolute manifest
   cannot become a reusable recipe on a different later runner. If using a
   preparation-only successor workflow, the original Protocol owner must add
   the explicit stop boundary and validate it; a successor needs its own exact
   source/normal supply. Alternatively Root can schedule the existing whole
   original job only after approving its complete bounded test window. Neither
   alternative is authorized or executed by this document.
2. At that actual caller, retain source/HEAD/tree and runtime architecture/boot
   identity. Validate the real current dispatch and original normal run through
   `scripts/ops/validate-pq-remote-normal-ci.py` with fresh profile. Reuse the
   original artifact, without compiling replacement binaries or a new signer.
3. Run the exact original `pqfreshprepare` step, capped at 3 minutes. Preserve
   its original ZIP, SOURCE, location-bound manifest and relocation receipt.
   Require the original controller's recipe validation to succeed, case only
   `prepared.json`, build only the four original ELFs plus business manifest,
   directories 0700 and prepared 0600. Return all actual absolute paths/hashes,
   eleven field names, fixed environment, source pins and runner identity.
4. Stop before `pqnetwork`. Apply for one complete bounded test window using
   those actual same-VM inputs. No prepared JSON boolean grants execution.

Preparation performs hashes, metadata API reads and archive copies, with no Go
compilation or node workload. Proposed budget: one serialized preparation,
up to 2 CPU workers, 1 GiB RSS, at most 1 GiB new case/build/intake bytes, 3 minutes
for original relocation plus 1 minute original normal-CI admission. Keep at least
1 GiB disk floor, 425 MiB Root reserve and 1 GiB compile reserve available; no
compile is requested. These are requested preparation limits, not measured use
or a replacement for the controller's fixed runtime caps.

The later original execution entry is:

```sh
python3 -B scripts/loadtest/pq-paired-linux-window.py \
  --consensus-fresh-paired-business \
  --prepared "$YNX_E2E_CASE/prepared.json" \
  --receipt "$YNX_E2E_CASE.receipt.json" --execute
```

It remains unexecuted. Original runtime caps remain 105 seconds active + 15
cleanup, 120 total, 1 GiB owned RSS, 16 processes, 320 threads, 512 MiB private
data, 1 MiB logs and 200 ms sampling. The original job also requires at least
150 seconds remaining in its 12-minute outer budget before execution. The two
arms contain 16 genuine business transfers each at 2/s, not a 1000 TPS test.
Synthetic local Host signers are isolated test identities, not public validator
credentials. First BFT formation remains distinct from proof observation.

## Handoff acceptance

Preparation is complete only after actual same-Linux-VM relocation, successful
original validation and preservation of its new absolute manifest, prepared,
receipt and caller identity. Those artifacts do not exist yet. The next action
belongs to Root's caller/window scheduling and, if a preparation-only workflow
is selected, the original Protocol workflow owner. Input readback alone is not
execution readiness, throughput measurement, public activation or goal completion.

## Root choice B: whole original job, pending compatible ref and window

Root selected B: retain the original workflow, with admission, relocation, both
fresh arms, proof checks and cleanup in the same ephemeral Linux job. No
preparation-only workflow change is requested. Root has not yet signed this
complete execution tuple or authorized dispatch.

The frozen machine-readable tuple is
`evidence/pq-fresh-e765-full-window-tuple.json`. It includes all thirteen
structured dispatch inputs, all 67 original focused-go step names/conditions,
original H/artifact/binary/source pins, concurrency, caps and actual remote ref
readback. The separate `DISPATCH_INPUTS.json` is retained beside the WD readback.
It selects only `consensus_fresh_paired_business=true`, normal run `40239167157`
and candidate e765; all other five window selectors are false, signer layout is
the unused default `atomic-json`, and signer authorization/digest inputs are empty.

The ref admission currently refuses execution. Actual remote heads were:

| Ref | Actual HEAD |
| --- | --- |
| main | 0dcffa5fd55bd4c66003b3fb0d0973eef87d4774 |
| codex/ynx-pq-perf-integration | 62f097e9c29959c3da1b0d2dcfc3cb62776f30e6 |
| codex/ynx-pq-public-upgrade | cbaf8122f8155de6c3d1edf660503952ce3795ab |

The complete `git ls-remote origin` snapshot locates e765 only at
`refs/pull/310/head`, with no branch or tag at that commit. `gh workflow run
--help` specifies a branch or tag for `--ref`; the original fresh entry also
accepts only main, the two original branches or a matching original frozen
`codex/ynx-pq-remote-*` branch. A PR ref, a newer branch with candidate e765, or
an invented current run ID does not satisfy that entry. Therefore the tuple's
`ref` is null and `executionReady=false`; no API dispatch was attempted. Original
Protocol must supply a genuinely compatible normal source/ref. Do not move a
shared branch, manufacture a replacement ref or substitute a newer candidate
while keeping the old normal-CI/artifact pins. Revalidate the entire tuple if
the candidate changes.

When compatible and Root signed, the existing CLI entry takes structured input:

```sh
gh workflow run resource-market-ci.yml --repo JiahaoAlbus/YNX-Chain \
  --ref "$ROOT_APPROVED_COMPATIBLE_REF" --json < DISPATCH_INPUTS.json
```

This is a command template, not a currently dispatchable command. Immediately
before dispatch, read that exact approved remote ref again and require HEAD to
equal the tuple candidate and its workflow bytes to equal the approved SHA256.
Preserve dispatch API output, resolve the one actual run ID, and follow only
that run. No automatic retry, rerun or second window after failure.

For a compatible fresh dispatch, only focused-go runs. verify, caddy-source,
artifact-release-cabi (both platform matrix arms), protocol-delivery,
proof-verifier-macos and pq-paired-n1 are excluded by their original job
conditions. Within focused-go the real path is checkout full exact source,
setup original Go, TLS/secret checks, identity, same-source normal-CI admission,
Linux window control tests, pqfreshprepare, pqnetwork, file-size metadata and
public log/receipt upload. The Linux control step has its original `!cancelled`
condition and may still run after normal admission fails; node execution still
requires successful normal admission and relocation. Normal full source Go
regressions, signing benchmarks, Node/contract compilation, new network binary
compilation, remote signer process and public stage export are excluded for
fresh. The source tuple retains every exact condition rather than treating all
source tests as absent by assumption.

Outer timeout is 12 minutes; normal admission is capped at 1 minute, relocation
at 3, node execution step at 3. Runtime remains the original 105+15/120 second
guard, with >=150 seconds outer time left required before node start. The
runtime RSS cap applies to owned runtime processes, not the entire GitHub job.
Setup/control work uses original GOMAXPROCS=2, GOGC=50 and GOMEMLIMIT=1536MiB;
these are not hardware or cgroup limits. Actual runner CPU/RAM/free disk/boot
identity must be recorded by the original runner/guard. No measured hardware
capacity or stronger hard limit is claimed here. All original disk/memory
floors and reserves remain as supplied in the tuple.

The four actual Comet Nodes, gateway, fixed client and verifier are confined to
that one VM and its fresh private case/build/intake. Both 16-transfer arms use
the same supplied binary hashes and fixed configuration with distinct fresh
epochs. Normal synthetic local Host signers remain test identities. Receipt,
stdout/stderr, file-size metadata, prepared, business manifest and relocation
receipt are uploaded for seven days by the original always-on-terminal path.
Retain failure/UNKNOWN and cleanup evidence before considering any new window.
The calibration cannot qualify sustained 1000 TPS or earliest BFT formation.
