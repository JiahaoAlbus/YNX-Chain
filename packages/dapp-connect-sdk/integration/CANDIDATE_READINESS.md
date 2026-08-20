# DApp SDK candidate readiness

Candidate scope: `packages/dapp-connect-sdk/**` only.

The package consumes the accepted P0 Wallet Protocol at
`66003e76e804da16d472255efde50cb879055b96`. It provides one standard-wallet
consumer API, EIP-6963/WalletConnect/SIWE helpers, durable callback handling,
optional Product Session degradation, endpoint-manifest validation,
Compatibility Lab, nine example recipes, migration scanning, and artwork
metadata validation.

Verified locally after consuming the exact candidate chain
`315897e75c0ffe3e63435fe73cfec42244b851cc` →
`0a03050c305eb2f7f0d53513bcf3ea6073ba3371` →
`24773900321b944444f37c7fcb2ea91b6f928d7e`:

- `npm test` — 12 tests passed.
- `npm run scan:migration` — no findings for the SDK source.
- `release:gate` against Integration commit
  `0c668adc257046924d4d631e03eb151986910462` —
  `BUNDLED_SHA256_ACCEPTED`, release
  `P0-WALLET-CONNECTIVITY-2026-08-endpoints-2`.
- Compatibility Lab — 0 passed, 10 explicitly skipped because real provider,
  relay, Gateway and platform adapters were not supplied.

Integration boundary:

- Integration accepts the exact bundled Endpoint Manifest using its canonical
  SHA-256 through its declared expiry. Remote replacement remains blocked until
  a protected signature verifies.
- Endpoint acceptance does not make an endpoint healthy. `UNAVAILABLE` and
  `PENDING` endpoint states remain prohibited; `DEGRADED` states retain their
  exact retry/degradation rule.
- `openWalletFaucet` remains fail closed because the Faucet deep-link contract
  is not accepted. The top-level Faucet service URL is not a Wallet deep link.
- Compatibility Lab's default run reports skipped scenarios when real wallet,
  relay, gateway, and platform adapters are absent. It never promotes skips to
  passes.

Integration accepted only the source-level SDK base at
`315897e75c0ffe3e63435fe73cfec42244b851cc`. The unified-client and bundled
manifest-verification additions remain an Integration candidate. This is not
public-deployment, installed-client, external-wallet, signing, transaction or
product-migration evidence.
