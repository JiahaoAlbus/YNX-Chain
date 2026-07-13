# Project State

- State snapshot baseline commit: `44870de Add persistent Bridge coordinator` (implementation baseline)
- Last pushed commit (implementation): `44870de94b1bf232b80e9b45f7b9d8be4980e59c`
- Chain repo state: `/Users/huangjiahao/Desktop/YNX Chain`, branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain.git`; the Bridge implementation commit is pushed and this acceptance update records its verified boundary.
- Website repo state: `/Users/huangjiahao/Desktop/YNX-Chain-website`, branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain-website.git`, pushed commit `752ea31 Add dual-format YNX address converter`.
- Vercel project `ynx-web4-website-new` (`prj_tPB0KDTFohQ9FXZAzq25mYFWkbNa`) is now Git-connected to `JiahaoAlbus/YNX-Chain-website`, production branch `main`; the previous `ynx-web4-website-new` repository is no longer the automatic source.
- Latest verified Vercel Git deployment: `dpl_HzXdQozR45aHva8VjAY6c4xZmgXM`, source repository `JiahaoAlbus/YNX-Chain-website`, branch `main`, exact commit `752ea31e509478be199c5ce2a6596a54df0b3398`, state `READY` and promoted to `www.ynxweb4.com`.

Remote deployment state:

- Ordinary authoritative chain release `97ed0c645bd2` is live on the primary, Singapore, Silicon Valley, and Seoul roles. All roles matched release-manifest SHA-256 `bc4d4aad...d7df` and `ynx-chaind` SHA-256 `845cb69e...a2e8`; fixed-height convergence passed at height `97455` and hash `f51f946a...7df1`; follower mutation probes returned HTTP `409`.
- Scoped predeploy backups were created for release `97ed0c645bd2`: about `12 MB` on primary and `5.5 MB` on each follower. No BFT freeze, pause, final snapshot, signer installation, candidate start, or ingress cutover phase ran.
- Active topology remains one authoritative producer plus three authenticated followers. It is not public CometBFT validator voting or Byzantine fault tolerance.
- `www.ynxweb4.com` now serves the intended full-stack website from Vercel. `ynxweb4.com` redirects to `www`.
- The production homepage uses a zero-image CSS/DOM chain scene with draggable depth layers, live block height, four role labels, block propagation, EVM/RPC/Index/Trust/State layers, responsive mobile behavior, and real public API data.
- Production deep links `/risk`, `/docs`, and `/testnet` return the SPA directly; `/docs` now links to the deployed address converter after commit `752ea31`.

Public proof state:

- Production website API proof observed chain ID `6423`, native `YNXT`, EVM `0x1917`, four validator-role records, and growing heights including `91091` and browser-rendered `92220`.
- Desktop and 390px mobile checks verified no horizontal overflow, no hero `<img>`, interactive layer expansion, mobile menu behavior, live height growth, current-state/mainnet boundary language, and direct route rendering.
- Public TLS connection attempts were intermittently slow or timed out during repeated verification; retries succeeded for production routes. This is an observed availability risk, not a claim of continuous outage or guaranteed availability.
- Existing Singapore-routed chain smoke remains operator-controlled evidence. Independent public-vantage proof, successful provider-backed AI generation, and public BFT proof remain absent.
- Post-deploy Singapore-routed smoke verified exact release identity, chain growth, EVM `0x1917`, REST/gRPC, Faucet-to-Explorer indexing, Pay, AI action governance, Trust/Chain Law requests, appeal/correction, transparency growth `180` to `192`, Resource flows, and IDE compile. Provider-backed AI SSE alone returned YNX HTTP `502`; it remains an external provider/quota blocker.
- Public address proof used the testnet account `0x7e5f...5bdf` and alias `ynx10e...hn80`: RPC alias and hex queries returned the same canonical account, Explorer returned both address formats, and Explorer search normalized the alias to the canonical address. The route was operator-controlled Singapore SSH with original TLS hostnames, not independent third-party proof.
- Production website proof converted the same shared vector in both directions, copied the exact `ynx1...` value, linked to the live Explorer account route, rejected mixed-case input without leaving a result link, and passed desktop plus 390px mobile overflow/console checks. The rendered homepage also observed live release `ynx-chain-97ed0c645bd2`.
- Direct public verification intermittently hit SSL/faucet connection timeouts; the controlled Singapore route succeeded. Public ingress stability remains a real operational risk.

Completed modules:

- Chain runtime, authoritative replication, RPC/EVM RPC, Faucet, Indexer, Explorer, monitoring, deployment, backup, rollback, AI action governance, Pay, Trust/Chain Law, Anti-Illegal Request, Request Validity, native YNXT protection, Appeal/Correction, Transparency, Resource Market, bounded IDE, and JS/Python SDK slices have real code and local tests. The authoritative public release provides operator-controlled public proof for the documented deployed subset.
- Website repository selection, Vercel Git binding, production deployment, real API aggregation, responsive CSS chain interaction, truthful disclosure routes, SPA deep links, and the dual-format account converter are implemented and production verified.
- Dual-format account addressing is implemented and remotely deployed: one canonical 20-byte account has lowercase EVM `0x...` and checksummed Bech32 `ynx1...` representations. Go/JS/Python shared vectors, signed-transfer canonicalization, REST boundary normalization, account-key public output, Explorer alias search/detail, dedicated Makefile checks, and operator-controlled public proof pass. EVM JSON-RPC and MetaMask remain on `0x...`.
- Bridge coordinator code is implemented and locally verified at `44870de94b1b`: persistent source-event/idempotency state, bounded route/finality/amount policy, Ed25519 relayer threshold, local-only finalization, audit integrity, authenticated handlers, health/metrics, restart checks, mutation freeze, and deployment-package wiring pass. The real deploy gate is false and external submission is disabled.
- Owner-handover tooling now classifies four validator identities, five future BFT service signers, the authoritative Faucet runtime account, the funded public proof account, and ephemeral smoke identities without reading secret values. `make owner-handover-check` is part of `make preflight` and fail-closes on tampering, stale commits, self-review, duplicate signers, unknown funded ownership, or incomplete recovery/handover assertions.
- A real mode-`0600` unreviewed packet was generated at `/Volumes/Data/Users/huangjiahao/.ynx-chain-custody/owner-handover-packets/owner-handover-4c3af99a39c2-20260713T184628Z`, bound to inventory digest `sha256:1674f8d80b6a8e4f09150a1f004486e33890dbd3cceb0e0fad062ddfbd9adb30`. It contains 12 public identity/status records, 9 handover-required identities, zero unknown ownership records, and no secret material.
- Production custody review now requires and revalidates packet-local owner inventory/receipt evidence, requires exact service-signer/evidence/hash equality, enforces four distinct roles (owner, handover reviewer, custody reviewer, transaction approver), and propagates exact owner hashes through freeze/cutover approval evidence and candidate binding.
- A current-commit replacement packet exists at `/Volumes/Data/Users/huangjiahao/.ynx-chain-custody/owner-handover-packets/owner-handover-d4bebbc22fe6-20260713T190221Z`, inventory digest `sha256:4e11b68953415234325d4e4873a7beae429e321969e0fd97391e52d8218ff558`. Its three files are mode `0600`; its receipt remains default-false and is correctly rejected.

Incomplete modules or requirements:

- Public CometBFT voting and BFT service routing are not active. No production BFT mutation phase has run.
- The owner packet is deliberately unacknowledged. Offline recovery, actual owner handover, signer rotation evidence, remote signer installation, and independent custody review remain incomplete; validation correctly rejects its default-false receipt.
- Provider-backed AI generation proof is incomplete because upstream quota returns HTTP `429`.
- Independent public-vantage evidence is absent.
- SDK registry publication, signed versioning, independent consumer proof, mainnet audit/legal/custody, exchange listing, stablecoin issuer support, wallet default support, production bridge readiness, and third-party partnerships remain incomplete and are not claimed.
- Bridge external-chain execution remains incomplete: there is no production relayer custody, approved asset route, external adapter, mint/burn authority, liquidity/rate controls, remote daemon, public endpoint, external transaction, rollback drill, independent audit, or public proof.
- Stablecoin issuer support remains readiness-only. There is no persistent issuer/asset authorization control plane, no issuer-bound mint/burn intent workflow, and no external issuer approval; native YNXT must remain outside all issuer asset actions.
- The production website exposes address conversion and the truthful MetaMask `0x...` boundary. Independent public-vantage proof is absent, and no wallet-default support is claimed.

Current blockers:

- Public BFT remains externally gated by recovery/handover/rotation evidence and independent custody approval.
- Successful AI generation remains blocked by external provider capacity/quota.
- Secret-bearing deployment and signer material must remain ignored and must never appear in commits or public proof.

Largest real gap that can still be advanced next:

- Implement a persistent Stablecoin Issuer Control Plane that separates issuer-governed represented assets from native YNXT, binds issuer/asset authorization and supply limits, records governance approval/revocation and mint/burn intents without executing external issuance, exposes authenticated APIs/audit/metrics, and remains truthful about absent issuer support and remote proof.
