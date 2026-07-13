# Project State

- State snapshot baseline commit: `c9324fb Verify custody review files before BFT execution`
- Last pushed commit before this acceptance update: `c9324fbfc464`
- Chain repo state: `/Users/huangjiahao/Desktop/YNX Chain`, branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain.git`. Current local changes implement and document the SDK proof slice; they are not part of deployed runtime release `c9324fbfc464`.
- Website repo state: `/Users/huangjiahao/Desktop/YNX-Chain-website`, expected branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain-website.git`. The current checkout, Vercel project binding, production source commit, and rendered live-data path still need fresh verification.

Remote deployment state:

- Ordinary authoritative release `c9324fbfc464` is live on the primary, Singapore, Silicon Valley, and Seoul roles.
- Every role matched release-manifest SHA-256 `3751ce0a52f44aed9b40da826bc2ad0a8630186f40009b4c010a384d70b3a3da` and `ynx-chaind` SHA-256 `f6709e58aa0e671431529a5e155a908e194862035e840f3f8029fb90e6ae93a1`.
- Fixed-height verification passed at height `85622` with hash `9c022089c080ae28a55756de26c97daf3cabe505374ac3ced0426903c7b3b702` on all four roles. Follower mutation probes returned HTTP `409`.
- Predeploy backups were about `9.0 MB` on primary and `4.9 MB` on each follower. The release archive SHA-256 was `d07b6673ea475f17cbe7f9e351117de43789a096f928d721870f6813fb160060`.
- The exact-release non-mutating BFT rehearsal passed at `tmp/public-bft-production-rehearsal/rehearsal-c9324fbfc464-20260713T111942Z`.
- Active topology is still one authoritative producer plus three authenticated followers. This is deterministic replication, not CometBFT validator voting or Byzantine fault tolerance.

Public proof state:

- The operator-controlled Singapore route passed current release/checksum identity, chain growth, four validator-role records, RPC/EVM/REST/gRPC, Faucet-to-Explorer indexing, Pay flows, AI action governance, Trust/Chain Law request classification/review/rejection, native YNXT protection, appeal correction, tracking review, Resource flows, bounded IDE compile, and current-chain Web4 binding.
- Transparency entries grew from `168` to `180` during the exact-release smoke.
- Web4 health is bound to `ynx_6423-1`, observed chain `6423`, native `YNXT`, and release `ynx-chain-c9324fbfc464`.
- Strict ecosystem proof still fails because authenticated AI SSE generation returns YNX HTTP `502` for upstream HTTP `429 insufficient_quota`.
- This is operator-controlled evidence, not independent third-party proof, mainnet proof, or public BFT proof.

Completed modules:

- Chain runtime, genesis/config, persistent state, restart recovery, authoritative four-role replication, RPC, EVM RPC, transaction/receipt/log/balance surfaces, Faucet, Indexer, Explorer, monitoring, deploy, backup, and rollback code are implemented and tested. The ordinary authoritative runtime is remotely deployed.
- AI Gateway, Pay API, Trust/Chain Law, Anti-Illegal Request Engine, Request Validity Standard, native YNXT no-direct-freeze rules, anti-unreasonable tracking, Appeal/Correction, Transparency, and Resource Market have independent service/runtime code, persistence, handlers, tests, deployment wiring, and authoritative public proof except provider-backed AI generation.
- All fifteen BFT Gateway compatibility capabilities have local/private candidate evidence. The candidate is absent and `publicCutoverReady=false` remains correct.
- BFT transaction preflight, scoped backup, mutation freeze/unfreeze, authoritative pause/resume, final snapshot, candidate/dependency deployment, continuity verification, checksummed ingress switch/restore, public thresholds, and rollback are implemented and failure-tested. Custody review files are revalidated by exact hash before execution.
- Explorer has a live Apple-inspired operational UI over real RPC/Indexer data with SSE updates, search, detail views, validators, resources, testnet boundaries, and MetaMask configuration.
- JavaScript and Python SDKs now provide REST status, EVM JSON-RPC, bounded timeout/error handling, canonical quantity parsing, chain snapshot validation, local fixture tests, package metadata, and read-only public compatibility proof. `make sdk-check`, `make developer-quickstart-check`, and `make sdk-remote-check` pass. They are not claimed as published to npm or PyPI.
- README positioning describes a full-stack blockchain ecosystem while explicitly denying unsupported mainnet, listing, issuer, wallet-default, and partnership claims.

Incomplete modules or requirements:

- Public CometBFT operation and public validator voting are not active.
- Five service signer identities exist on an owner-local FileVault volume, but the recovery copy is on the same volume. Offline recovery, owner handover, rotation evidence, independent custody review, and remote signer installation are incomplete.
- No production BFT transaction mutation phase has run: no transaction backup, freeze, pause, final migration snapshot, candidate/dependency start, ingress switch, or cutover.
- Provider-backed AI generation proof is incomplete because upstream quota returns HTTP `429`.
- Independent public-vantage evidence is absent.
- The separate website repository, Vercel production binding, and rendered use of current live APIs are not freshly verified.
- SDK registry publication, signed release/versioning, and independent consumer proof are not complete.
- Mainnet audit/legal/custody, exchange listing, stablecoin issuer support, wallet default support, bridge production readiness, and third-party partnerships are not complete and are not claimed.

Current blockers:

- Public BFT is blocked by real external custody work: offline recovery restore, owner handover, rotation evidence, and an independent reviewer distinct from the transaction approver. Review packets remain unapproved and authorize nothing.
- Successful AI generation proof is blocked by external provider capacity/quota.
- Secret-bearing deployment and signer material stays ignored and must never be committed, printed, or treated as public evidence.

Largest real gap that can still be advanced next:

- Verify the intended website repository and Vercel production binding, integrate real current YNX public chain data, deploy, and inspect the production URL on desktop and mobile. This is locally actionable while BFT custody and AI quota remain external blockers. Do not expand bounded EVM/IDE or run any BFT mutation phase.
