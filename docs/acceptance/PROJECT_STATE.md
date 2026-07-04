# Project State

Updated: 2026-07-04

- State snapshot baseline commit: `1a12cc3 Classify remote deployment blockers`
- Last pushed commit known locally at snapshot time: `1a12cc3`
- Chain repo state: `/Users/huangjiahao/Desktop/YNX Chain`, branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain.git`, changed in this update in structured Request Validity rules, Trust label metadata, check scripts, API docs, tracker, and state files.
- Website repo state: `/Users/huangjiahao/Desktop/YNX-Chain-website`, branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain-website.git`, latest observed commit `1ddc977 Harden website readiness and deployment`.

Completed modules in the chain repo:

- Local chain, faucet, indexer, explorer service code exists with Go tests.
- Deploy, dry-run, verify, ops, backup, rollback, host-key audit, legacy inventory, remote smoke, public proof, and package commands exist.
- `remote-smoke-test` checks public RPC, EVM RPC, REST, gRPC, faucet, indexer, explorer, AI, and Web4 endpoints before mutable proof actions.
- Legacy backup coverage is wired into deployment and ops checks.
- `remote-blocker-report` classifies node failures and public endpoint failures instead of only pasting raw error blocks.
- `deploy-readiness-gate` reads `tmp/verify-testnet/remote-blockers.json` and blocks real `deploy-testnet` mutation when SSH or public ingress evidence is unsafe. `DEPLOY_DRY_RUN=1` skips the gate for local dry-run validation only.
- Anti-Illegal Request Engine now has persistent request intake, classification, rejection, and transparency entries.
- Request Validity Standard now classifies scoped review, insufficient evidence, overbroad tracking, illegal/abusive requests, governance review, user notice, and rejected states through named rule IDs exposed by `GET /governance/request-validity-rules`.
- Trust labels now include label ID, address, type, severity, risk weight, confidence, source, evidence hash, update time, expiry, review and appeal metadata, dispute status, legal status, rejected-request reference, and an advisory-only asset effect that rejects freeze/seize/confiscation behavior.
- Appeal / Transparency APIs now persist Trust appeals and expose transparency report counts and entries.
- Appeals can now be resolved with reviewer, decision, updated status, resolution reason, transparency entries, and corrective labels for false-positive removal/reduction.
- Anti-Unreasonable Tracking now has a dedicated persistent tracking review API with purpose logging, evidence checks, minimum necessary data, sensitive/institutional review, confidence, expiry, appeal path, and transparency entries.
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md` now tracks all required modules with strict local/remote/proof status.

Incomplete modules or requirements:

- New remote `ynx_6423-1` public testnet is not proven live.
- Four-node remote validator set is not proven live.
- Public endpoints are not proven to serve the new network.
- Faucet, explorer, indexer, AI, Pay, Trust, Resource, IDE, governance, appeal, transparency, and website status are not proven against the new remote network.
- Appeal resolution / false-positive correction is implemented locally and now writes rich corrective Trust label metadata, but is not remotely deployed or publicly proven.
- Anti-unreasonable tracking policy is implemented locally but not remotely deployed or publicly proven.
- Real `.env.deploy` is not present locally; only env templates are present.

Remote deployment state:

- `make host-key-audit` on 2026-07-04 still fails, but the latest classification changed: primary and Seoul strict SSH are accepted; Singapore and Silicon Valley are `host-key-mismatch` and must not be mutated until manually verified.
- `remote-smoke-test` evidence generated at `2026-07-04T14:11:36.802Z` failed with a mixed public state: RPC/indexer/Web4 still show legacy `ynx_9102-1`, EVM chain id is `0x238e` instead of `0x1917`, validator set evidence is empty, block height did not grow during the check, REST/faucet/AI/EVM block calls timeout, and explorer health/summary return 404.
- `remote-blocker-report` generated fresh `tmp/verify-testnet/REMOTE_BLOCKERS.md` and `tmp/verify-testnet/remote-blockers.json` with deploy gate status `blocked`.
- `make deploy-readiness-gate` currently fails, as intended, listing Singapore/Silicon Valley host-key mismatches and public ingress blockers including timeouts and explorer 404s.
- This is not public proof.

Current blockers:

- Remote mutation is unsafe until Singapore and Silicon Valley host-key mismatches are manually verified and corrected.
- Public service endpoints still prove old-chain or broken state, not new `ynx_6423-1` readiness.
- Real deploy env values and secrets are not available in a committed-safe form.

Largest real gap that can still be advanced in-repo:

- Tighten Trust evidence weighting, reviewer exports, and risk scoring semantics while remote deployment remains blocked.
