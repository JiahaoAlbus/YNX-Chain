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
| Checkout commit/tree | `0068b75d1e9f65fa706ec829d5cd07ea996af6da` / `05260fa85864bf10af45f430664aaa2a18631ff0` | — |
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

The DEX release owner must create a new immutable contract artifact package
from one exact source commit, regenerate its manifest and all compiled artifact
hashes, and independently verify the package before requesting any Testnet
deployment lease.  The replacement must retain truthful release flags: current
local contract integration is not evidence of public deployment, installed
delivery, Wallet approval, LP activity, Swap execution, or production signing.

Do not use the existing `release/dex` artifact manifest to authorize a current
contract deployment.

