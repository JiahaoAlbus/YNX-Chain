# Quant real HTTP introduction compatibility

Inherited clean checkpoint `36f9c5a0c8fbd9bfe8db9d5c3d256a47fb2d2cfc`.
This successor changes tests/evidence only: the immutable `bd85c9590` Linux
candidate, product handler, engine, SDK and introduction bytes are unchanged.

New actual HTTP test uses the real TenantServer, real tracked HTML assets and
original security-header wrapper over a disposable filesystem state location.
It starts two successive actual httptest HTTP listeners (closing the first
before reopening storage), each with eight concurrent independent anonymous
clients reading seven routes. All 112 requests require exact original asset
bytes, 200/no redirect, no-store, CSP/referrer headers and no session cookie.
Both original callback paths and query-bearing application paths retain the
workspace. Actual product health/version endpoints remain JSON rather than
introduction HTML; HEAD preserves body-free app semantics. Separate missing
and symlink introduction tests require fallback to the original workspace.
No private session, account, market adapter, strategy write, sign or transaction
is manufactured. Anonymous concurrency is not authenticated-tenant isolation.

`go test ./apps/quant-lab/server -race -count=1`: PASS, 1.439s.
Initial focused run failed because the new fixture incorrectly expected
productId `quant`, while the real original API reports `ynx-quant-lab`.
Corrected the assertion to the original `quantlab.ProductID` constant; did not
change the API to fit the test. The actual filesystem health correctly reports
multiInstance=false/ready=false: this local test does not prove production DB
readiness. `git diff --check`: PASS.

## Fresh non-sensitive public identity reads

2026-10-04 read-only GET, bounded ten-second timeout, redirect=manual. No SSH,
Host/config mutation or Wallet action. Only status/content identity was read.

| URL | Status / bytes | SHA256 | Identity |
| --- | --- | --- | --- |
| https://finance.ynxweb4.com/version | 200 / 127 | 92eee2e51b111513df0f3637bf257aad8ac1d532c96a2e3640f6b07e7b5abaa8 | commit 17d2d6dd0f9e30c7639bb5ccdf919c4896280e6c, release root3-lifecycle-17d2d6dd0 |
| https://exchange.ynxweb4.com/api/version | 200 / 107 | b4c022607d648d184914ec7e9041fc4e7c5c2ce5fcc13392f18350bfc2a6d8a8 | commit 91c1a40587d28ad4c931d4a4d601766bd467ea20, version 0.1.0-testnet |
| https://quant.ynxweb4.com/api/version | 200 / 274 | f82629a1bd63e50f6721611cbf7866f86d7bffd51820b05a417590541c4653df | commit 664b80b00ac576317524f25b49fc01d1c0db7196, version 0.2.0-testnet |

Exchange `/version` separately returned 200 / 15995 bytes, text/html SHA256
e19bfb7281f35515b5d5648f893803af94ea3a0c64ed46d766f3495a8e7b63ab:
that route is not a valid JSON version oracle. The real `/api/version` above
does exist; do not incorrectly diagnose all Exchange APIs as HTML fallback.
These public versions do not match the newly handed-off microsite candidates.
Formal matching publication remains with unique A; no deployment completion,
public provider approval, installed proof or private business is inferred.
