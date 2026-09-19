# DEX source-backed pool analytics checkpoint

Branch: `codex/final-dex`  
Implementation: `c71e5b1f2e6dbf5a1cb819348a4bbd9791f8e851`  
Tree: `fdcdc1f7ecab448d50c9eee92bddc46f1bdf5da8`  
Predecessor: `c0d77725f8cb529b9c88a42dd59ddd2250cb5ecd`

## Product changes

- Missing event fee fields are now represented as unavailable rather than the fabricated numeric value zero.
- The selected pool shows raw committed reserves, confirmed swap count, direction-normalized raw volume and explicit complete/partial/unavailable fee coverage.
- The analytics page calculates bounded constant-product depth scenarios from the selected committed reserve snapshot. It labels them read-only scenarios, not orders or historical trades.
- Fiat TVL and annualized yield remain unavailable unless a verified oracle is integrated. The UI states that boundary rather than deriving a false fiat metric.
- The Playwright fixture now intercepts the current `/v1/native-snapshot` contract instead of retired `/dex/assets`, `/dex/pools` and `/dex/events` routes. Desktop and mobile E2E no longer depend on the unavailable local proxy.

## Verification

- `npm test` — 29/29 PASS.
- `npm run build` — PASS.
- `npm run verify:canonical-authorize` — PASS across 15 DEX source files.
- `npm run test:e2e` — 9 PASS, 1 intentional desktop skip for the mobile-only layout assertion; desktop and Pixel 7 projects covered.
- `go test -race ./internal/dex/...` — PASS.
- `go vet ./internal/dex/...` — PASS.
- Built index SHA-256: `52988e01edf2fb0c00985c29cbf417957cabf2d327f6df99e073916271f99617`.
- Built JavaScript SHA-256: `dac6681513b15ad77104bcb6ca479ab2454763b8bd60e3e5a9a184240961618f`.
- Built CSS SHA-256: `add58adde017e7997468f983e62ab221058778dbfd03d30035e17d52ccc761de`.

## Truth and next boundary

This is a pushed source/build/local-browser checkpoint only. It is not public deployment or Testnet transaction evidence. Product Session, Wallet approval, swap, liquidity, installed runtime and production gates remain false.

The next public step requires a DEX-only deployment lease with fresh current-runtime and rollback binding. The write path separately requires a real proof-bound YNX Wallet Product Session and immediate user confirmation; neither is inferred from source tests.
