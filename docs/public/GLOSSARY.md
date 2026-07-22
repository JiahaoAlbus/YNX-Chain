# YNX Public Glossary

| Metadata | Value |
| --- | --- |
| Version | 1.0.0-candidate |
| Effective date | 2026-07-22 |
| Evidence source commit | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |

| Term | Definition |
| --- | --- |
| YNX Chain | A Web4 Layer-1 ecosystem under Testnet engineering. |
| YNX | Short name for YNX Chain when unambiguous. |
| YNX Web4 | The application ecosystem powered by YNX Chain. |
| YNXWeb4 | Compact alternate name; editorial prose prefers YNX Web4. |
| Web4 | YNX product term for user-controlled accounts, permissioned applications, verifiable execution, evidence-linked automation and explicit human approval; not an adopted Internet standard claim. |
| YNXT | Native Testnet asset of YNX Testnet. No represented monetary value or guaranteed liquidity is claimed. |
| YNX Testnet | Test network using EVM chain ID 6423 and Comet/Cosmos chain ID `ynx_6423-1`. |
| EVM chain ID | Numeric replay-protection/network identifier exposed to EVM-compatible interfaces; YNX Testnet uses 6423 (`0x1917`). |
| Comet/Cosmos chain ID | Consensus network identifier; YNX Testnet uses `ynx_6423-1`. |
| Accepted baseline | Component/source accepted by the central release authority; separate from an owner candidate. |
| Candidate | Proposed or locally implemented state that has not passed every integration/release gate. |
| Shadow candidate | Code that may compare behavior without voting or changing authoritative state. |
| Testnet | Network for testing; not Mainnet, production value or investment evidence. |
| Mainnet | A separately approved production network. No current Mainnet launch is implied. |
| implementedLocal | Claimed behavior exists in source on the identified commit. |
| testedLocal | Directly relevant local test passed on the identified source. |
| installedLocal | Exact package was installed and cold-started on the stated target. |
| integratedCentral | Accepted component is incorporated into the central release line. |
| deployedStaging | Exact release is deployed in a staging environment. |
| deployedPublic | Exact release is independently reachable at a public endpoint. |
| downloadHosted | Exact artifact is hosted at an immutable URL with digest and byte count. |
| productionSigned | Exact artifact carries owner-approved production signing. |
| storeReleased | Exact artifact is publicly distributed by the named store. |
| Authoritative state | State established by the defined authority, such as committed chain state or accepted Wallet approval. |
| Derived data | Calculation or index based on named sources; not automatically authoritative. |
| Third-party data | Data supplied under a provider’s scope, terms and freshness; cannot replace YNX authority outside that scope. |
| AppHash | Deterministic commitment to YNX ABCI application state. |
| StreamBFT | Disabled-by-default YNX shadow consensus candidate; the public network is not claimed to run it. |
| Local fee market | Candidate pricing domain for bounded resource/lane capacity; not active public fee policy. |
| Burn | Irreversible supply destruction; never revenue. |
| Buyback | Treasury purchase; not burn unless followed by a separate verifiable burn. |
| Revenue | Earned consideration under a disclosed policy; excludes user principal, burn and unsupported estimates. |
| Stablecoin | Asset intended to track a reference value under an issuer/reserve/redemption framework. YNXT is not a stablecoin. |
| Canonical asset | Asset issued under the identified authority on its origin chain. |
| Represented asset | Bridged/wrapped representation with additional bridge/custody/redemption risks. |
| Proof of reserves | Evidence about included reserve assets; not complete solvency without liabilities and control evidence. |
| Proof of solvency | Scoped assets-minus-liabilities evidence with control, valuation, exceptions and independent review. No current YNX claim is established. |
| Strategy mandate | User-signed, bounded authority for a strategy, including limits, expiry, nonce domain, revocation and exit. |
| Safety Module | Candidate loss-coverage pool design; no YNX module is currently implemented. |
| Operator-controlled evidence | Evidence gathered by project operators; useful but not an independent public vantage. |
| Independent public evidence | Evidence observed from a separate public vantage and bound to exact release identity. |
| Unknown outcome | Action result cannot be authoritatively determined; must not be displayed as success or blindly retried. |

## Change log

- 1.0.0-candidate (2026-07-22): Established canonical public definitions and
  release/economic authority terminology.
