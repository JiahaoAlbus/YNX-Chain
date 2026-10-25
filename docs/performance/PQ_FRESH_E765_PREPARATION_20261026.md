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
