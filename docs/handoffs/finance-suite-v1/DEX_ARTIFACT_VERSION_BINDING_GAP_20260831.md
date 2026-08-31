# DEX artifact version-binding gap — 2026-08-31

## Scope

This is a Finance-suite integration handoff for the local DEX contract artifact
gate.  It makes no deployment, chain, Wallet, public-runtime, or release-state
claim.

## Direct finding

`npm run dex:manifests:check` passes on the current Finance-suite checkout.
`npm run dex:artifacts:verify` fails before any deployment action because its
checked-in release manifest binds an earlier Factory source object than the one
currently compiled and tested.

| Item | Current checkout | `release/dex/artifact-manifest.json` binding |
| --- | --- | --- |
| Checkout commit/tree | `7475fe72cba07c0757e21d07fe121bf36c261574` / `573c66aabf0bbc033b2ed8782fce3b703c68d01b` | — |
| Manifest source base | — | `5b4eb9e1511577ce73291d97fdc0b9aa376b0383` |
| `YNXDexFactory.sol` blob | `97b480200791555f19a27a6b97aa3e9da72c7489` | `3634985c2fd17b131ff418a8e5582a6a0a408d63` |
| Bytes | `5665` | `5653` |
| SHA-256 | `b7a6699e10709d98ba9317b5aaeecbab28b64367c04b05d3f56757c8f55519f0` | `50de7f09d8313b9b88ce670631daf663497a2ceae37e429bc0337caa235dea4e` |

The source delta is the current Factory forwarding `address(0)` as the new
Pool constructor's fee-recipient argument.  Therefore the older manifest is
not source-bound to the contract integration result below.

## Local evidence

| Command | Result |
| --- | --- |
| `npm run dex:manifests:check` | PASS |
| `npm run dex:artifacts:verify` | FAIL: `contracts/dex/YNXDexFactory.sol size` — `5665 !== 5653` |
| `npm run dex:contracts:test` | PASS |

## Required next action

Central's independently recorded DEX C7 decision is
`DEX_C7_SHARED_BINDING_IS_NOT_ROOT_FILE_ONLY_AND_REQUIRED_COHERENT_MANIFEST_SET_NOT_FROZEN`
(`release/integration/p0-wallet-connectivity/acceptance/dex-c7-shared-release-binding-no-go-20260831.json`).
It prohibits a root-only update: the source commit must be bound coherently in
the DEX product release, Chain Core contract record, public-product metadata,
and operator runtime-source input before packaging.

The next DEX release owner must first freeze one composed source checkpoint
that includes the current C7 Wallet lifecycle candidate and this v1.35
fail-closed custody change. Central must then produce the coherent four-file
binding from that exact composed checkpoint. Only after that may the owner
regenerate an immutable contract artifact package and all compiled hashes, run
the manifest/artifact gates, and request a separate Testnet deployment lease.
The replacement must retain truthful release flags: local contract integration
is not evidence of public deployment, installed delivery, Wallet approval, LP
activity, Swap execution, or production signing.

Do not use the existing `release/dex` artifact manifest to authorize a current
contract deployment.
