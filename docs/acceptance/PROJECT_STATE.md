# Project State

Updated: 2026-07-09

- State snapshot baseline commit: `00f67e2 Add bounded EVM SSTORE transfer path` before this update
- Last pushed commit known locally before this update: `00f67e2 Add bounded EVM SSTORE transfer path`
- Chain repo state: `/Users/huangjiahao/Desktop/YNX Chain`, branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain.git`, changed in this update in generic pinned-artifact write-call subset execution beyond ERC20 transfer, canonical local EVM storage-slot keys, `SampleEVMWriteCounter` proof coverage, API docs, tracker, contract tooling checks, and state files.
- Website repo state: `/Users/huangjiahao/Desktop/YNX-Chain-website`, branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain-website.git`, latest observed commit `1ddc977 Harden website readiness and deployment`.

Completed modules in the chain repo:

- Local chain, faucet, indexer, explorer service code exists with Go tests.
- Deploy, dry-run, verify, ops, backup, rollback, host-key audit, legacy inventory, remote smoke, public proof, and package commands exist.
- `remote-smoke-test` checks public RPC, EVM RPC, REST, gRPC, faucet, indexer, explorer, AI, and Web4 endpoints before mutable proof actions.
- Legacy backup coverage is wired into deployment and ops checks.
- `remote-blocker-report` classifies node failures and public endpoint failures instead of only pasting raw error blocks.
- `deploy-readiness-gate` reads `tmp/verify-testnet/remote-blockers.json` and blocks real `deploy-testnet` mutation when SSH or public ingress evidence is unsafe. `DEPLOY_DRY_RUN=1` skips the gate for local dry-run validation only.
- Anti-Illegal Request Engine now has persistent request intake, classification, rejection, and transparency entries.
- Pay API now records merchant idempotency keys for intents, invoices, refunds, and webhook signatures; duplicate idempotency requests return the original object instead of creating conflicting records.
- Pay API now persists audit events with audit hashes and stores webhook signature metadata for lookup without storing or exposing signing secrets.
- AI Gateway now persists scoped permission grants and sensitive action proposals with audit hashes; value-moving, Trust-label-affecting, and sensitive-data AI actions remain non-executable until a matching active permission is explicitly approved.
- EVM RPC now returns persisted transaction logs in receipts and filters logs by block range, address, and topics through `eth_getLogs`.
- Contract deploy and verify records now expose deterministic event metadata parsed from Solidity `event` declarations, and local contract deployment receipts emit contract-address logs filterable through `eth_getLogs`.
- IDE compile now exposes deterministic local artifact metadata with source hash, bytecode hash, deployed bytecode hash, artifact hash, artifact kind, pinned Solidity `0.8.24` compiler config hash, compiler execution status, deployed bytecode comparison status, ABI, events, functions, selector source, `bytecodeSelectorMatched`, local runtime storage seed, runtime storage-slot metadata, compiler mode, runtime mode, verifier mode, reproducibility status, and limitations. Repository sources that match built Hardhat artifacts upgrade to `pinned-solc-bytecode-artifact`; ad hoc IDE snippets remain `source-analyzer-artifact`. `POST /ide/deploy` accepts optional `constructorArgs`, stores them in contract metadata, and seeds canonical 32-byte hex local storage slots for simple public `uint` assignments such as `totalSupply = initialSupply`, `SampleEVMWriteCounter.count = initialCount`, plus `mapping(address=>uint)` assignments such as `balanceOf[msg.sender] = initialSupply` for local verifier/devnet evidence. `artifacts/ynx-selector-metadata.json` records `ethers` Keccak selectors and deployed-bytecode selector presence for repository Hardhat artifacts, including `SampleEVMWriteCounter.count()` and `increment(uint256)`. `GET /ide/verifier/{address}` exposes explicit local verifier service evidence without claiming remote public proof. IDE/EVM calls distinguish source-analyzer literal returns from a bounded read-only EVM opcode interpreter staticcall subset that executes supported Hardhat getters such as ERC20 `decimals()`, constructor-seeded `totalSupply()`, mapping-backed `balanceOf(address)`, and `SampleEVMWriteCounter.count()` from solc deployed bytecode plus local storage seed. `POST /ide/execute` and local EVM `eth_sendTransaction` now support a generic pinned-artifact write-call subset for supported nonpayable/payable calldata that fits the bounded local state-transition interpreter; proof covers ERC20 `transfer(address,uint256)` and `SampleEVMWriteCounter.increment(uint256)`, records `storageWrites`, updates local runtime storage, decodes bounded ABI output, and creates `contract_call` transactions. ERC20 Transfer logs remain filterable after block production; generic bytecode logs are counted but not yet ABI-replayed into persisted receipts. It is still not a full EVM state-transition engine and does not support arbitrary opcode coverage, complex dynamic storage layouts, remote deployment, or remote public proof.
- Request Validity Standard now classifies scoped review, insufficient evidence, overbroad tracking, illegal/abusive requests, governance review, user notice, and rejected states through named rule IDs exposed by `GET /governance/request-validity-rules`.
- Trust labels now include label ID, address, type, severity, risk weight, confidence, source, evidence hash, update time, expiry, review and appeal metadata, dispute status, legal status, rejected-request reference, and an advisory-only asset effect that rejects freeze/seize/confiscation behavior.
- Trust evidence packets now include reviewer-facing `riskSummary` with effective advisory risk weight, active/expired/low-confidence label counts, non-conclusive label IDs, active evidence hashes, appeal path, reviewer notes, and advisory-only asset effect. Expired labels and labels below 5000 confidence bps are excluded from active risk scoring.
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

- Extend the generic pinned-artifact write-call subset toward fuller EVM state-transition semantics, especially broader opcode coverage, richer storage layouts, ABI-replayed generic logs/receipts, more return-shape coverage, or wire remote verifier/explorer-backed proof while remote deployment remains blocked.
