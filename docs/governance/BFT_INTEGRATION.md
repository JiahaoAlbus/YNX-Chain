# BFT Integration Guide

## Overview

YNX Governance integrates with the chain consensus layer through ABCI (Application Blockchain Interface). All governance actions are submitted as signed transactions, validated by consensus, and result in deterministic state transitions with execution receipts.

## Architecture

```
User Wallet → App Gateway → Governance Service → BFT Gateway → ABCI Handler → Chain State
                    ↓                                                  ↓
              Internal HMAC                                    Execution Receipt
```

## Action Envelope

All governance transactions use a canonical action envelope:

```go
type ActionEnvelope struct {
    Domain       string          // "ynx-governance-action/v1"
    ChainID      uint64          // 6423
    Action       string          // Action type
    Signer       string          // 0x-prefixed address
    AccountNonce uint64          // Sequential nonce
    Product      string          // "governance"
    DeviceID     string          // Device identifier
    SessionID    string          // Session identifier
    ExpiresAt    string          // RFC3339 timestamp
    PayloadHash  string          // SHA-256 of payload
    Payload      json.RawMessage // Action-specific payload
    Signature    string          // secp256k1 signature
}
```

## Supported Actions

1. **governance_proposal_create** - Create new proposal
2. **governance_deposit** - Submit deposit for proposal
3. **governance_simulation_record** - Record simulation results
4. **governance_conflict_disclose** - Disclose conflicts of interest
5. **governance_electorate_submit** - Submit electorate snapshot
6. **governance_electorate_approve** - Approve electorate snapshot
7. **governance_voting_open** - Open voting period
8. **governance_vote_cast** - Cast a vote
9. **governance_vote_finalize** - Finalize voting results
10. **governance_proposal_cancel** - Cancel proposal
11. **governance_execution_begin** - Begin proposal execution
12. **governance_execution_verify** - Verify execution result
13. **governance_role_assign** - Assign governance role
14. **governance_role_remove** - Remove governance role
15. **governance_emergency_create** - Create emergency action
16. **governance_emergency_approve** - Approve emergency action
17. **governance_emergency_close** - Close emergency action

## Validation Flow

### CheckTx (Pre-consensus Validation)

```go
1. Unmarshal action envelope
2. Validate domain, chainID, product
3. Check signature validity
4. Verify account nonce sequence
5. Check for replay attacks (txHash already processed)
6. Validate action-specific payload
7. Return acceptance/rejection
```

### DeliverTx (Consensus Execution)

```go
1. Re-validate envelope (CheckTx rules)
2. Mark txHash as processed
3. Execute action-specific state mutation
4. Increment account nonce
5. Compute new state root
6. Generate execution receipt
7. Return receipt with outcome
```

## Execution Receipt

```json
{
  "schemaVersion": "ynx-governance-execution-receipt/v1",
  "txHash": "0xabc...",
  "blockHeight": 12345,
  "blockHash": "0xdef...",
  "stateRoot": "0x123...",
  "manifestHash": "0x456...",
  "source": "ynx-bft-consensus",
  "version": "1.0.0",
  "outcome": "verified",
  "asOf": "2026-07-23T10:30:00Z",
  "auditHash": "0x789..."
}
```

**Outcomes:**
- `verified` - Action executed successfully
- `failed` - Action failed validation or execution
- `verified_rollback` - Rollback executed successfully

## State Management

### On-Chain State

The ABCI handler maintains:
- **Proposals**: Map of proposalID → ChainProposal
- **Votes**: Map of proposalID → account → ChainVote
- **Roles**: Map of account → ChainRole
- **Emergencies**: Map of emergencyID → ChainEmergency
- **AccountNonces**: Map of account → nonce
- **ProcessedTxHashes**: Set of executed transaction hashes

### State Root Computation

```go
stateRoot = SHA256(CanonicalJSON(chainState))
```

State root is deterministic and computed after every transaction.

## Query Interface

ABCI Query paths:
- `proposal` - Get proposal by ID
- `votes` - Get all votes for proposal
- `role` - Get role for account

## Replay Protection

1. **Nonce Sequencing**: Each account must use sequential nonces
2. **TxHash Registry**: Processed transaction hashes are stored
3. **Expiry Enforcement**: Expired envelopes are rejected
4. **Signature Binding**: Signature covers all envelope fields

## Integration Checklist

- [x] Action envelope types and validation
- [x] ABCI handler (CheckTx, DeliverTx, Query)
- [x] On-chain state management
- [x] State root computation
- [x] Execution receipt generation
- [x] Replay protection
- [x] Nonce management
- [ ] Wire into main ABCI application
- [ ] Deploy to testnet
- [ ] Capture real execution receipts
- [ ] Verify determinism across validators

## Testing

Run chain governance tests:

```bash
cd chain/governance
go test -v
```

Tests verify:
- Proposal creation and state updates
- Vote casting and power tracking
- Role assignment and expiry
- Nonce validation and replay protection
- Query interface correctness

## Next Steps

1. Integrate `chain/governance/abci_handler.go` into main ABCI app
2. Deploy governance service with BFT gateway
3. Submit test proposal through consensus
4. Verify execution receipt matches expected state
5. Test multi-validator determinism
6. Capture testnet transaction hashes for evidence
