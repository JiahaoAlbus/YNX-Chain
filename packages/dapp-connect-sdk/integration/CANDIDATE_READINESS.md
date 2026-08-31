# DApp SDK candidate readiness

Candidate scope: `packages/dapp-connect-sdk/**` only.

The package consumes the accepted P0 Wallet Protocol at
`66003e76e804da16d472255efde50cb879055b96`. It provides one standard-wallet
consumer API, EIP-6963/WalletConnect/SIWE helpers, durable callback handling,
optional Product Session degradation, endpoint-manifest validation,
Compatibility Lab, nine example recipes, migration scanning, and artwork
metadata validation.

Verified locally for this candidate:

- `npm test` — 11 tests passed.
- `npm run scan:migration` — no findings for the SDK source.
- `npm run release:gate` — passed with endpoint activation intentionally blocked.

Integration boundary:

- The central public Endpoint Manifest currently declares
  `CANDIDATE_NOT_ACCEPTED` and `UNSIGNED_CANDIDATE`.
- `loadBundledManifest` and `openWalletFaucet` therefore fail closed with typed
  errors; no RPC, Gateway, Faucet, product endpoint, or deep link is activated.
- Compatibility Lab's default run reports skipped scenarios when real wallet,
  relay, gateway, and platform adapters are absent. It never promotes skips to
  passes.

This is a candidate handoff, not public-deployment evidence. Integration must
accept the candidate contract and supply a signed, unexpired Endpoint Manifest
before consumer activation.
