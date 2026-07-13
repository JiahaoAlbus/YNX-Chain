# Project State

- State snapshot baseline commit: `97ed0c6 Add reversible ynx1 account addresses`
- Last pushed commit: `97ed0c6 Add reversible ynx1 account addresses`
- Chain repo state: `/Users/huangjiahao/Desktop/YNX Chain`, branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain.git`; code commit is pushed and the only current changes are this post-deployment acceptance update.
- Website repo state: `/Users/huangjiahao/Desktop/YNX-Chain-website`, branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain-website.git`, pushed commit `7a638b0 Fix production SPA deep links`.
- Vercel project `ynx-web4-website-new` (`prj_tPB0KDTFohQ9FXZAzq25mYFWkbNa`) is now Git-connected to `JiahaoAlbus/YNX-Chain-website`, production branch `main`; the previous `ynx-web4-website-new` repository is no longer the automatic source.
- Latest verified Vercel Git deployment: `dpl_22cxGGiFypkzebGXhibDk7eaWG6q`, source commit `7a638b033d289d335d26500597d230a33b046d6e`, state `READY`.

Remote deployment state:

- Ordinary authoritative chain release `97ed0c645bd2` is live on the primary, Singapore, Silicon Valley, and Seoul roles. All roles matched release-manifest SHA-256 `bc4d4aad...d7df` and `ynx-chaind` SHA-256 `845cb69e...a2e8`; fixed-height convergence passed at height `97455` and hash `f51f946a...7df1`; follower mutation probes returned HTTP `409`.
- Scoped predeploy backups were created for release `97ed0c645bd2`: about `12 MB` on primary and `5.5 MB` on each follower. No BFT freeze, pause, final snapshot, signer installation, candidate start, or ingress cutover phase ran.
- Active topology remains one authoritative producer plus three authenticated followers. It is not public CometBFT validator voting or Byzantine fault tolerance.
- `www.ynxweb4.com` now serves the intended full-stack website from Vercel. `ynxweb4.com` redirects to `www`.
- The production homepage uses a zero-image CSS/DOM chain scene with draggable depth layers, live block height, four role labels, block propagation, EVM/RPC/Index/Trust/State layers, responsive mobile behavior, and real public API data.
- Production deep links `/risk`, `/docs`, and `/testnet` return the SPA directly after commit `7a638b0`.

Public proof state:

- Production website API proof observed chain ID `6423`, native `YNXT`, EVM `0x1917`, four validator-role records, and growing heights including `91091` and browser-rendered `92220`.
- Desktop and 390px mobile checks verified no horizontal overflow, no hero `<img>`, interactive layer expansion, mobile menu behavior, live height growth, current-state/mainnet boundary language, and direct route rendering.
- Public TLS connection attempts were intermittently slow or timed out during repeated verification; retries succeeded for production routes. This is an observed availability risk, not a claim of continuous outage or guaranteed availability.
- Existing Singapore-routed chain smoke remains operator-controlled evidence. Independent public-vantage proof, successful provider-backed AI generation, and public BFT proof remain absent.
- Post-deploy Singapore-routed smoke verified exact release identity, chain growth, EVM `0x1917`, REST/gRPC, Faucet-to-Explorer indexing, Pay, AI action governance, Trust/Chain Law requests, appeal/correction, transparency growth `180` to `192`, Resource flows, and IDE compile. Provider-backed AI SSE alone returned YNX HTTP `502`; it remains an external provider/quota blocker.
- Public address proof used the testnet account `0x7e5f...5bdf` and alias `ynx10e...hn80`: RPC alias and hex queries returned the same canonical account, Explorer returned both address formats, and Explorer search normalized the alias to the canonical address. The route was operator-controlled Singapore SSH with original TLS hostnames, not independent third-party proof.
- Direct public verification intermittently hit SSL/faucet connection timeouts; the controlled Singapore route succeeded. Public ingress stability remains a real operational risk.

Completed modules:

- Chain runtime, authoritative replication, RPC/EVM RPC, Faucet, Indexer, Explorer, monitoring, deployment, backup, rollback, AI action governance, Pay, Trust/Chain Law, Anti-Illegal Request, Request Validity, native YNXT protection, Appeal/Correction, Transparency, Resource Market, bounded IDE, and JS/Python SDK slices have real code and local tests. The authoritative public release provides operator-controlled public proof for the documented deployed subset.
- Website repository selection, Vercel Git binding, production deployment, real API aggregation, responsive CSS chain interaction, truthful disclosure routes, and SPA deep links are implemented and production verified.
- Dual-format account addressing is implemented and remotely deployed: one canonical 20-byte account has lowercase EVM `0x...` and checksummed Bech32 `ynx1...` representations. Go/JS/Python shared vectors, signed-transfer canonicalization, REST boundary normalization, account-key public output, Explorer alias search/detail, dedicated Makefile checks, and operator-controlled public proof pass. EVM JSON-RPC and MetaMask remain on `0x...`.

Incomplete modules or requirements:

- Public CometBFT voting and BFT service routing are not active. No production BFT mutation phase has run.
- Offline recovery, owner handover, signer rotation evidence, remote signer installation, and independent custody review remain incomplete.
- Provider-backed AI generation proof is incomplete because upstream quota returns HTTP `429`.
- Independent public-vantage evidence is absent.
- SDK registry publication, signed versioning, independent consumer proof, mainnet audit/legal/custody, exchange listing, stablecoin issuer support, wallet default support, production bridge readiness, and third-party partnerships remain incomplete and are not claimed.
- The production website does not yet expose address conversion or document the dual-format wallet boundary. Independent public-vantage proof is absent, and no wallet-default support is claimed.

Current blockers:

- Public BFT remains externally gated by recovery/handover/rotation evidence and independent custody approval.
- Successful AI generation remains blocked by external provider capacity/quota.
- Secret-bearing deployment and signer material must remain ignored and must never appear in commits or public proof.

Largest real gap that can still be advanced next:

- Add the now-deployed dual-address converter and truthful MetaMask boundary to the intended website repository, deploy through the confirmed Vercel project, and verify production desktop/mobile behavior. This is the next locally actionable full-ecosystem surface while public BFT remains custody-gated and AI generation remains provider-blocked.
