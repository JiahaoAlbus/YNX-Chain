# Weekly v3 integration candidate — 2026-09-20

This document records the single isolated Finance, Wallet, RPC and Faucet
integration candidate. It does not claim official Alpaca Sandbox, public alias,
Live, Mainnet, installed-device or production verification.

## Baseline and source mapping

- Review base: `cfc66f4ae7588715a4c1eb7ba5e991ceac08815c`
  (`codex/weekly-v3-review-base-20260919`).
- Finance/Network/RPC/Faucet delivery: PR #137 head
  `c35e3427335620ddf04c6a0cfc2abe7f06f2b300`.
- Wallet native/Faucet delivery: PR #136 head
  `4d1992f99645589ab69ea7856db647b900d47704`.
- Wallet browser acceptance delivery: PR #139 head
  `de4287cb013a6491fe60b8a84d96a8ad5d6ee04a`.
- Root npm and Go security delivery: PR #138 head
  `b5964f7d25ba44cbe658da1ee422565fa854e942`.
- Finance owner checkpoint: `9912d29f82d5ceca689f07e20e944648a2be6de3`.
  The Weekly v3 Broker Sandbox sequence runs from
  `fa3d66b169d22d52b936d57bbf35ab92cb023ec5` through that checkpoint
  (25 commits).
- The earlier broad integration checkpoint was
  `029add3e6c07fbe522eeac4568c3af137c417c1b`. It is retained in history for
  provenance, but is superseded by the scope-narrowed candidate recorded by
  this document.
- Scope-narrowing implementation checkpoint:
  `329f3357d3c72b0e2d40ace56922ef205c232438`. The exact published checkpoint
  passed the Finance/Wallet race integration and consolidated Weekly v3 local
  gate before this documentation-only follow-up.

## Integration decisions

The Network head is the tree baseline because the Wallet branch predates the
durable Faucet and Finance/Network baseline. Wallet runtime, packaging and test
paths use the final browser head behavior; historical browser screenshots,
intermediate proposals and superseded Wallet Auth test histories are omitted.
The final Wallet deep-link configuration retains both `authorize` and `action`
entry points.

Finance uses the final owner state for the Weekly v3 changed paths, the complete
`internal/finance` package, the Web connection baseline, the two Mobile contract
files consumed by Finance verification, and `internal/productsessionv2`. The
Network-only `apps/finance/gateway` remains present. Unreferenced superseded
Finance vendor bundles are omitted. This imports the existing Finance
implementation and its dependencies rather than creating test-only stubs.

The security dependency graph and audit policy are retained. The audit policy's
source checkpoint is rebound to a commit reachable from this candidate. Shared
Cloud dependency evidence is refreshed only because the root Go dependency
graph changed. The placeholder gate excludes the Finance public-endpoint
manifest in both scanner implementations because `example.com` appears there
only in its fail-closed rejection list.

Mail, Merchant, Music, Pay, Social, Calendar, DEX and Resource Market source and
workflow paths are identical to the Network baseline. Their unrelated histories
were not imported and their products were not modified to satisfy integration
CI. The Wallet iOS workflow runs the existing pin verifier against its own new
workflow only, while the verifier's default global behavior remains unchanged.

An earlier Wallet-base experiment demonstrated that PR #137 cannot be safely
applied onto the older Wallet tree without replacing its durable Faucet base.
That experiment was neither pushed nor used as this candidate. No source branch
was rewritten, reset, cleaned or force-pushed.

## Local verification

Passed on the scope-narrowed working tree before publication:

- root `npm ci`, full and production npm audit: zero reported vulnerabilities;
  audit policy and self-test; placeholder, Hardhat and contract gates;
- `go test ./...`, `go vet ./...`, and `govulncheck`: no reachable Go
  vulnerabilities (module findings reported by the tool were unreachable);
- Wallet Web: 354/354; focused browser fixtures: 13/13;
- Wallet native TypeScript: 509/509; Faucet focused tests: 96/96; SecureStore
  patch tests: 11/11;
- Android Faucet engine JVM unit tests and offline standalone runtime APK build;
- Finance Go packages and commands; Finance browser/product suite: 48/48;
- Finance/Wallet isolated race integration: pass with unchanged checkpoints,
  including draft, approval/reject/revoke, execution fences, status,
  reconciliation, recovery and provider-wire fixtures;
- Testnet configuration/migration fixtures, Faucet multi-user and durable race
  tests, SDK clean-consumer compatibility, chain metadata and Mainnet rejection;
  the consolidated local gate reports every check passed.

The macOS Foundation iOS harness was terminated by the local execution
environment with exit 137 before creating its output directory. It remains
unverified in this candidate; the TypeScript/native contract and Android paths
above are independently verified.

## Truthful remaining states

- Official Alpaca Broker API Sandbox: `NOT_VERIFIED` (credentials absent).
- Public `rpc-testnet` and `faucet-testnet` activation/runtime: `NOT_VERIFIED`.
- Installed Wallet/device interoperability: `NOT_VERIFIED` by this candidate.
- Live trading, Mainnet and production approval: disabled and not attempted.
- No public Faucet POST or real securities provider write was made.

## Rollback

The candidate is additive on the immutable review base. Keep all owner branches
and their heads unchanged. Before merge, rollback is deleting the candidate
branch/worktree. After merge, revert the integration merge commit; do not reset
or rewrite the source branches. RPC/Faucet alias activation has its own
data-preserving rollback package and is not activated by this code candidate.
