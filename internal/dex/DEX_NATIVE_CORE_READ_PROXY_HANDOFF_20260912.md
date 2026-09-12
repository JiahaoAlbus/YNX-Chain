# DEX operator-fixed native Core read proxy

Local source/build/test checkpoint only. No SSH, public requests, deployment,
Wallet approval, signature, transaction, or frontend modification occurred.

## Exact lineage and ownership

- Branch: `codex/dex-native-core-read-proxy-20260912`.
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/27-dex-core-read-20260912`.
- Inherited source: `804554e9a8377d8a0ea35528048df049e0e4f835`, tree `c678d2779b27ea06bb795a00d9f716015a051634`.
- Implementation: `ce629b890446924dda93ccbd3b1136e4735e732e`, tree `c14c1390eb54fada8341359f7208d53713c9ca24`.
- Four implementation files only: `cmd/ynx-dex-indexerd/main.go`, `internal/dex/server.go`, `internal/dex/native_read_proxy.go`, `internal/dex/native_read_proxy_test.go`.
- Accepted Core contract: `28d30b4b9ac983811f1e6a87f7620ec3bf3f8316`, `docs/api/native-finance-snapshot-v1.md`. No Core/Wallet/shared SDK or shared packager changes.
- Exchange checkpoint `835a76a6ca4ce6ba29a62c24adf0418cde3dfe11` was preserved untouched.
- Machine evidence: `internal/dex/evidence/native-core-read-proxy-20260912.json`, blob `10c5fa99a3d1513ed91feadbe3a19423269bb182`, 6107 bytes, SHA-256 `429bae6a737333a9fe112271c79303151dd347440f549c7002a174d7af0956b1`.

## Operator and frontend contract

Set only `YNX_DEX_NATIVE_CORE_URL` to the independently verified Core **origin**:
HTTPS, or HTTP at a literal loopback address. This slice intentionally supplies
no guessed/default production endpoint. URL credentials, paths (including `/`),
query, fragment, noncanonical hostname/port and environment HTTP proxies are
rejected; errors do not echo the supplied URL. Empty configuration leaves native
reads at 503 `NATIVE_CORE_UNCONFIGURED`, without disabling the existing EVM
indexer API or changing Standard Wallet connection state.

The existing indexer server now exposes:

- `GET /v1/native-snapshot`, optionally exactly one `account` with canonical
  lowercase `0x` address or checksummed lowercase YNX alias. Alias conversion
  uses existing `internal/accountaddress` and sends its canonical `0x` form.
- `GET /v1/native-transactions/{hash}`, canonical lowercase `0x` plus 64 hex
  characters, no query. Explicit Core 404 `not_found` remains 404 and unchanged.

No client endpoint, callback, session, account credential, HTTP body, arbitrary
query, Origin, Cookie, Authorization, forwarding header, conditional header or
range reaches Core. Noncanonical encoded/traversal routes are rejected before
ServeMux can redirect. Upstream headers are not relayed: responses set only
`application/json`, `Cache-Control:no-store`, and `nosniff` plus normal HTTP
server framing. Read errors use `status:unknown`, `scope:native-core-read`, and
`coverage.complete:false`, never fabricated zero holdings or global offline.

There is one upstream GET, no redirects or implicit reused-connection retry,
no authentication, no submission route, no balance cache, and no second ledger.
Limits: 5-second request, 2-second dial/TLS handshake, 3-second response headers,
16 KiB response headers, 4 MiB snapshot, 1 MiB receipt, 16 concurrent reads per
process. Busy/error/malformed/oversized responses fail 503. This is not a claim
of a distributed global rate limiter; the existing indexer admission is retained.

UTF-8 JSON is validated for duplicate keys, depth, trailing content and identity
envelope, then the original body bytes are forwarded. Decimal strings and
`memory_only`, `uncertain`, `pending_durable`, `durable` evidence stay verbatim;
empty/missing proof is never synthesized or promoted. Deep ledger, coverage and
durability verification remains the existing frontend contract's responsibility.

Snapshots require chain ID **string `6423`** and the exact account identity.
The official Core Transaction/receipt has **no independent `chainId` field**.
Receipt network binding therefore rests on operator-pinned Core origin plus
the accepted source/schema and exact hash; it does not claim a separate chain
proof or invent `ynx_6423-1`. Official Core golden snapshot and receipt raw-byte
regressions both pass. No BFT/consensus finality is claimed.

## Verification and artifacts

Go `go1.25.7 darwin/arm64`:

- `go test -race -count=1 ./internal/dex ./cmd/ynx-dex-indexerd`: PASS.
- `go vet ./internal/dex ./cmd/ynx-dex-indexerd`: PASS.
- `go test -run '^TestNative' -count=3 ./internal/dex`: PASS (12 top-level native tests plus table cases).
- `git diff --check`: PASS.
- Real local HTTP fixtures cover two users concurrently, gateway reopen,
  credential/header isolation, canonical path/query rejection, Core golden
  bytes, all receipt statuses, invalid JSON/HTML/compression/oversized responses,
  redirects, cancellation/concurrency recovery, and lost connection without
  retry followed by a separate explicit read that succeeds.

Build flags and every source/artifact identity are frozen in the machine
evidence. Release `ynx-dex-native-core-read-ce629b890446`, build time
`2026-09-12T10:48:44Z`, source `ce629b890446924dda93ccbd3b1136e4735e732e`:

- Linux amd64 backend executable: `/tmp/ynx-dex-native-core-read-20260912.FWIU2F/ynx-dex-indexerd-linux-amd64`, 6,979,768 bytes, SHA-256 `c13fd5974c5fc55ed371cb1a56c5b2d4a24ed18489a0ea9cb29869839d631968`; ELF64 x86-64 statically linked. Built, not executed on Linux or installed.
- Darwin arm64 backend executable: `/tmp/ynx-dex-native-core-read-20260912.FWIU2F/ynx-dex-indexerd-darwin-arm64`, 6,659,874 bytes, SHA-256 `49f60d6aa60f10b27ffe390b32c6f033e363812664e7bd1f524624d20b94b89a`.
- The actual Darwin main process was cold-started three times against an
  isolated synthetic Core fixture: unconfigured native 503; configured raw
  snapshot 200; configured restart 200. Each `/version` reported the exact
  source, `/health` was 200, shutdown exit was 0, total upstream reads were 2,
  and no state file/second ledger was created. These are not public/live-Core,
  browser, installer or real-account tests.

These are backend binaries, not DMG/EXE/APK end-user installers or a complete
Web/PWA deployment. No publicly hosted download is claimed.

## Central integration and rollback boundary

Cherry-pick the source and this evidence/handoff commit separately into the
current DEX owner; keep its ongoing `apps/dex` and shared packager changes.
Rebuild/freeze the combined Web + indexer release from that integration source,
configure the operator-selected authoritative native Testnet origin, and obtain
source-bound runtime/visible evidence there. This candidate does not modify
existing store format or require a database migration. Reverting the owner
source commit restores the prior indexer API; before any future deployment,
bind its actual prior release/config/service and product-specific rollback.
No production rollback commands or prior deployment authority are inferred.

Single next executable integration gap: the parent DEX owner must bind a real
operator Core origin and deploy/test the combined current source. Public Core
read, installed app, Wallet approval/signature, transaction execution,
swap/liquidity, Product Session migration and ComputerControl remain false.
