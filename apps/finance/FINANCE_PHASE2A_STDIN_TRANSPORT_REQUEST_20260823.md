# Finance Phase 2A stdin transport request

Supersedes local-path argv. P0-230 acceptance is `f971effaea38b9346fa28c3977e1cb0a9a6bd6b7` / `98878d0c321d93c72abb288ff8487dc5d29faa7a`; only carrier `p0228-finance-phase1-20260822T234100Z` is allowed. The builder frames archive, generator and Phase2B executor in fixed order as `name mode bytes sha256 base64-data`; remote references no local path.

Frozen bootstrap SHA-256 and fixture results must be bound by a new lease. Literal future SSH argv:

```text
ssh <signed-host> /bin/bash -c 'boot=$(printf %s "$1" | base64 -d); shift; /bin/bash -c "$boot" phase2a "$@"' phase2a <BOOTSTRAP_BASE64> p0228-finance-phase1-20260822T234100Z /opt/ynx/stage/finance/p0228-finance-phase1-20260822T234100Z <rootTuple> <stageParentTuple> <stageTuple> <leasesParentTuple> <leaseParentTuple> <carrierTuple>
```

`BOOTSTRAP_BASE64` is the SHA-bound frozen bootstrap bytes; stdin is only the exact framed carrier produced by `build-finance-phase2a-stdin-carrier.mjs`. The remote never references a local path. No SSH is authorized by this request. The remote validates all settled tuples, exact empty carrier, frame order/size/hash/end-of-input, and only creates three lease-parent files. It neither reads env nor runs generator/Phase2B nor writes carrier or production state.
