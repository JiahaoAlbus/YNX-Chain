# Project State

- State snapshot baseline commit: `9445e9e Add live-verified JavaScript and Python SDK clients`
- Last pushed commit: `9445e9e Add live-verified JavaScript and Python SDK clients`
- Chain repo state: `/Users/huangjiahao/Desktop/YNX Chain`, branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain.git`, clean before this acceptance update.
- Website repo state: `/Users/huangjiahao/Desktop/YNX-Chain-website`, branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain-website.git`, pushed commit `7a638b0 Fix production SPA deep links`.
- Vercel project `ynx-web4-website-new` (`prj_tPB0KDTFohQ9FXZAzq25mYFWkbNa`) is now Git-connected to `JiahaoAlbus/YNX-Chain-website`, production branch `main`; the previous `ynx-web4-website-new` repository is no longer the automatic source.
- Latest verified Vercel Git deployment: `dpl_22cxGGiFypkzebGXhibDk7eaWG6q`, source commit `7a638b033d289d335d26500597d230a33b046d6e`, state `READY`.

Remote deployment state:

- Ordinary authoritative chain release `c9324fbfc464` remains live on the primary, Singapore, Silicon Valley, and Seoul roles. Fixed-height convergence, checksummed release identity, predeploy backups, and read-only BFT rehearsal remain the current chain deployment evidence.
- Active topology remains one authoritative producer plus three authenticated followers. It is not public CometBFT validator voting or Byzantine fault tolerance.
- `www.ynxweb4.com` now serves the intended full-stack website from Vercel. `ynxweb4.com` redirects to `www`.
- The production homepage uses a zero-image CSS/DOM chain scene with draggable depth layers, live block height, four role labels, block propagation, EVM/RPC/Index/Trust/State layers, responsive mobile behavior, and real public API data.
- Production deep links `/risk`, `/docs`, and `/testnet` return the SPA directly after commit `7a638b0`.

Public proof state:

- Production website API proof observed chain ID `6423`, native `YNXT`, EVM `0x1917`, four validator-role records, and growing heights including `91091` and browser-rendered `92220`.
- Desktop and 390px mobile checks verified no horizontal overflow, no hero `<img>`, interactive layer expansion, mobile menu behavior, live height growth, current-state/mainnet boundary language, and direct route rendering.
- Public TLS connection attempts were intermittently slow or timed out during repeated verification; retries succeeded for production routes. This is an observed availability risk, not a claim of continuous outage or guaranteed availability.
- Existing Singapore-routed chain smoke remains operator-controlled evidence. Independent public-vantage proof, successful provider-backed AI generation, and public BFT proof remain absent.

Completed modules:

- Chain runtime, authoritative replication, RPC/EVM RPC, Faucet, Indexer, Explorer, monitoring, deployment, backup, rollback, AI action governance, Pay, Trust/Chain Law, Anti-Illegal Request, Request Validity, native YNXT protection, Appeal/Correction, Transparency, Resource Market, bounded IDE, and JS/Python SDK slices have real code and local tests. The authoritative public release provides operator-controlled public proof for the documented deployed subset.
- Website repository selection, Vercel Git binding, production deployment, real API aggregation, responsive CSS chain interaction, truthful disclosure routes, and SPA deep links are implemented and production verified.

Incomplete modules or requirements:

- Public CometBFT voting and BFT service routing are not active. No production BFT mutation phase has run.
- Offline recovery, owner handover, signer rotation evidence, remote signer installation, and independent custody review remain incomplete.
- Provider-backed AI generation proof is incomplete because upstream quota returns HTTP `429`.
- Independent public-vantage evidence is absent.
- SDK registry publication, signed versioning, independent consumer proof, mainnet audit/legal/custody, exchange listing, stablecoin issuer support, wallet default support, production bridge readiness, and third-party partnerships remain incomplete and are not claimed.
- Native accounts currently use canonical EVM-compatible `0x...` representation. A reversible YNX human-readable `ynx1...` representation is not implemented in chain code, SDKs, Explorer, or the website.

Current blockers:

- Public BFT remains externally gated by recovery/handover/rotation evidence and independent custody approval.
- Successful AI generation remains blocked by external provider capacity/quota.
- Secret-bearing deployment and signer material must remain ignored and must never appear in commits or public proof.

Largest real gap that can still be advanced next:

- Implement dual-format account addressing: preserve canonical 20-byte `0x...` addresses for EVM JSON-RPC, MetaMask, Solidity, and ABI compatibility while adding checksummed Bech32 `ynx1...` encode/decode, REST normalization, SDK conversion, Explorer display/search, and tests. This is locally actionable and directly answers the native-wallet identity gap without weakening EVM compatibility.
