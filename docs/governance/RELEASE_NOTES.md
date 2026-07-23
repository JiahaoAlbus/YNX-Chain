# Release notes

## v0.2.0-local (Unreleased)

This local Governance candidate adds BFT chain integration, smart contracts, and a standalone UI to the existing control-plane service.

### What's New

**BFT Chain Integration**
- Action envelope validation with canonical hashing and signature verification
- ABCI handler implementing CheckTx, DeliverTx, and Query paths
- On-chain state management for proposals, votes, roles, and emergencies
- State root computation for deterministic AppHash
- Execution receipt generation with verified/failed/rollback outcomes
- Nonce sequencing and replay protection via txHash registry
- Support for all 17 governance actions defined in the integration manifest

**Smart Contracts**
- `YnxGovernance.sol` - Main governance contract with proposal lifecycle, voting, and role management
- `YnxParameterStore.sol` - Parameter storage with type constraints and min/max bounds enforcement
- `YnxTimelock.sol` - Timelock enforcement with configurable delays (1-30 days)
- `YnxEmergencyPause.sol` - Multi-sig emergency pause for bridges, oracles, markets, vaults, providers, and upgrades

**Standalone UI**
- Proposal list view with status filtering (all, active, voting, completed)
- Detailed proposal view showing summary, economic impact, security risk, migration, and rollback plans
- Parameter change visualization with before/after diff and bounds display
- Voting interface with approve/reject/abstain options
- Real-time voting statistics with quorum and threshold indicators
- Timelock countdown display
- Evidence and documentation links
- Klein Blue (#002FA7) branding throughout
- Responsive design with Apple-grade polish

### What's Still Missing

The complete product is not yet implemented or tested locally because:
- Smart contracts lack tests (Hardhat/Foundry setup needed)
- UI lacks component tests (Vitest setup needed)
- BFT handler not wired into main ABCI application
- Governance service not connected to BFT gateway
- No end-to-end testnet deployment with real transactions
- No execution receipts captured from chain
- No Explorer/Monitor integration for transaction display
- No 12-language internationalization

It is also not centrally integrated, staging-deployed, publicly deployed, production signed, download hosted, or store released. External execution remains disabled and local execution status must not be interpreted as a chain transaction.

### Technical Details

**BFT Integration:**
- Domain: `ynx-governance-action/v1`
- Chain ID: 6423
- Nonce domain prevents cross-action replay
- Canonical JSON encoding before signing (RFC8785-compatible)
- State root: SHA-256 of canonical state
- Receipt schema: `ynx-governance-execution-receipt/v1`

**Smart Contracts:**
- Solidity 0.8.20
- Custom errors for gas efficiency
- No single administrator role
- Role expiry enforcement
- Emergency duration capped at 7 days
- Multi-sig threshold for emergency actions

**UI Stack:**
- React 18
- TypeScript 5
- Vite 4
- No external UI libraries (custom components)
- Vite proxy routes `/governance` to `http://127.0.0.1:6441`

### Evidence

- Go service tests: `internal/governance/*_test.go` (20 tests passing)
- BFT handler tests: `chain/governance/abci_handler_test.go` (4 tests passing)
- Smart contract source: `contracts/governance/*.sol` (~1,060 lines)
- UI source: `apps/governance/src/**/*.tsx` (~1,200 lines)
- Commits: `75d3412`, `7d0b5ce`

## v0.1.0-local (Previous)

Initial local Governance control-plane candidate with bounded proposal lifecycle, policy-owned parameters, vote/delegation integrity, term-scoped roles, emergency-pause constraints, tamper-evident persistence, canonical Gateway assertions, backup/restore, aggregate observability, and hardened service packaging.
