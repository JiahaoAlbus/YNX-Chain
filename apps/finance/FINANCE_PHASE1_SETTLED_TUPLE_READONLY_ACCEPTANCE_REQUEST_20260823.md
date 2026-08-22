# Finance Phase 1 settled-tuple read-only acceptance request

This wholly new Finance-only request supersedes the creation-time parent `nlink` fields that caused P0-228 to fail closed. It is not a Phase 2 preparation or production deployment request.

## Frozen failure record

- Central release: `dcfdb94394ec53c646dfd2f93383dd5e92de7653` / tree `e2c32ca7f3296db1de2be25ef0264b2527c7480f`.
- P0-228 lease blob: `f9fbdf128f4a1eee512db7b96c53f89e8f222c78`; SHA-256 `33d0223a663fc50b38cd7677d34fe766245e29f8f1b9a912d6a78b2a52412787`.
- Status: `CONSUMED_RELEASED_FAILED_CLOSED_FINANCE_PHASE1_RECEIPT_FINAL_TUPLE_NLINK_MISMATCH`; P0-228 is nonreusable.
- Retained receipt: `/tmp/ynx-finance-p0228-phase1-receipt-20260822T234100Z.txt`, 553 bytes, SHA-256 `9e73bc473eb3fa4c35ab55216e64830a809e3339eed3c9c83af15637af5f6cc0`.

## Expected settled observation

| Path | Exact settled tuple |
| --- | --- |
| `/opt/ynx` | `64770:1312502:0:0:755:47:4096:directory` |
| `/opt/ynx/stage` | `64770:3450040:0:0:750:3:4096:directory` |
| `/opt/ynx/stage/finance` | `64770:3450041:0:0:750:3:4096:directory` |
| `/opt/ynx/leases` | `64770:3450042:0:0:750:3:4096:directory` |
| `/opt/ynx/leases/finance-preparation` | `64770:4594820:0:0:750:2:4096:directory` |
| `/opt/ynx/stage/finance/p0228-finance-phase1-20260822T234100Z` | `64770:4594821:0:0:700:2:4096:directory` |

The carrier must be empty. Production remains unchanged with active PID `877083` and `NRestarts=0`.

## Literal read-only command object

```bash
set -euo pipefail
tuple() { if ! test -d "$1" || test -L "$1"; then return 1; fi; stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
test "$(tuple /opt/ynx)" = '64770:1312502:0:0:755:47:4096:directory'
test "$(tuple /opt/ynx/stage)" = '64770:3450040:0:0:750:3:4096:directory'
test "$(tuple /opt/ynx/stage/finance)" = '64770:3450041:0:0:750:3:4096:directory'
test "$(tuple /opt/ynx/leases)" = '64770:3450042:0:0:750:3:4096:directory'
test "$(tuple /opt/ynx/leases/finance-preparation)" = '64770:4594820:0:0:750:2:4096:directory'
carrier=/opt/ynx/stage/finance/p0228-finance-phase1-20260822T234100Z
test "$(tuple "$carrier")" = '64770:4594821:0:0:700:2:4096:directory'
test -z "$(find "$carrier" -mindepth 1 -print -quit)"
systemctl show ynx-finance --property=MainPID --value
systemctl show ynx-finance --property=NRestarts --value
```

The command object performs no mkdir, write, upload, cleanup, environment read, service restart, deployment, account request, signature or transaction. It records only path/tuple/emptiness/PID/restart receipts. Any mismatch is fail-closed and requires no cleanup because this request mutates nothing.

## Future source correction

The successor bootstrap emits terminal tuples only after all children exist while retaining creation tuples solely for failure cleanup.

- Bootstrap: 3,631 bytes, SHA-256 `693913cb5a521c1e463587d2c3b7ad9e81e106a05b270076d7e15be9fadbccc8`.
- Actual-shell fixture: 21,924 bytes, SHA-256 `c840a290c81f91a2529f88b830e9af897ba4c7e31522d1bf260543c0c0a5defd`.

No Phase 2 request or execution may follow until Central accepts the settled tuple observation under a wholly new lease.
