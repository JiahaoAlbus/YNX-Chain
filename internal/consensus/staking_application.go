package consensus

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func (a *Application) applyStakingAction(state executionState, raw []byte, tx SignedApplicationAction, height int64, blockTime time.Time, validationOnly bool) (executionState, transactionExecution, error) {
	if err := a.chargeApplicationAction(&state, tx); err != nil {
		return executionState{}, transactionExecution{}, err
	}
	txHash, recordID := ApplicationActionHash(raw), ""
	switch tx.Action {
	case ActionStakeDelegate:
		var input StakeDelegatePayload
		_ = json.Unmarshal(tx.Payload, &input)
		if !a.activeValidator(input.Validator) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("staking validator is not active in the migration validator set"))
		}
		accountIndex, ok := accountIndex(state.accounts, tx.Signer)
		if !ok || state.accounts[accountIndex].Balance < input.AmountYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("insufficient liquid YNXT for delegation after fee"))
		}
		if state.accounts[accountIndex].Staked > math.MaxInt64-input.AmountYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("staked balance overflow"))
		}
		state.accounts[accountIndex].Balance -= input.AmountYNXT
		state.accounts[accountIndex].Staked += input.AmountYNXT
		recordID = stakingDelegationID(tx.Signer, input.Validator)
		index, found := stakingDelegationIndex(state.stakeDelegations, recordID)
		if found {
			record := state.stakeDelegations[index]
			if record.AmountYNXT > math.MaxInt64-input.AmountYNXT {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("delegation amount overflow"))
			}
			record.AmountYNXT += input.AmountYNXT
			record.Status = "active"
			record.UpdatedAt = blockTime
			record.BlockHeight = height
			record.TxHash = txHash
			record.AuditHash = ""
			record.AuditHash = stakingAuditHash(record)
			state.stakeDelegations[index] = record
		} else {
			record := BFTStakeDelegation{ID: recordID, Delegator: tx.Signer, Validator: input.Validator, AmountYNXT: input.AmountYNXT, CommissionBPS: StakingCommissionBPS, RewardSource: "none_until_governed_issuance_activation", Status: "active", CreatedAt: blockTime, UpdatedAt: blockTime, BlockHeight: height, TxHash: txHash}
			record.AuditHash = stakingAuditHash(record)
			state.stakeDelegations = insertStakeDelegation(state.stakeDelegations, record)
		}
	case ActionStakeUnbond:
		var input StakeUnbondPayload
		_ = json.Unmarshal(tx.Payload, &input)
		index, ok := stakingDelegationIndex(state.stakeDelegations, input.DelegationID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("staking delegation not found"))
		}
		record := state.stakeDelegations[index]
		if record.Delegator != tx.Signer || record.AmountYNXT < input.AmountYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unbond exceeds signer-owned delegation"))
		}
		accountIndex, ok := accountIndex(state.accounts, tx.Signer)
		if !ok || state.accounts[accountIndex].Staked < input.AmountYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("delegator staked balance is inconsistent"))
		}
		state.accounts[accountIndex].Staked -= input.AmountYNXT
		record.AmountYNXT -= input.AmountYNXT
		if record.AmountYNXT == 0 {
			record.Status = "unbonded"
		}
		record.UpdatedAt = blockTime
		record.BlockHeight = height
		record.TxHash = txHash
		record.AuditHash = ""
		record.AuditHash = stakingAuditHash(record)
		state.stakeDelegations[index] = record
		recordID = ApplicationActionRecordID("stake-unbonding", txHash)
		entry := BFTUnbondingEntry{ID: recordID, DelegationID: record.ID, Delegator: tx.Signer, Validator: record.Validator, AmountYNXT: input.AmountYNXT, Status: "queued", RequestedAt: blockTime, AvailableAt: blockTime.Add(time.Duration(StakingUnbondingSeconds) * time.Second), BlockHeight: height, TxHash: txHash}
		entry.AuditHash = stakingAuditHash(entry)
		state.unbondings = insertUnbonding(state.unbondings, entry)
	case ActionStakeWithdraw:
		var input StakeWithdrawPayload
		_ = json.Unmarshal(tx.Payload, &input)
		index, ok := unbondingIndex(state.unbondings, input.UnbondingID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unbonding entry not found"))
		}
		entry := state.unbondings[index]
		if entry.Delegator != tx.Signer || entry.Status != "queued" {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unbonding entry is not withdrawable by signer"))
		}
		if !validationOnly && blockTime.Before(entry.AvailableAt) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unbonding entry is not yet available"))
		}
		accountIndex, _ := accountIndex(state.accounts, tx.Signer)
		if state.accounts[accountIndex].Balance > math.MaxInt64-entry.AmountYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("withdrawal balance overflow"))
		}
		state.accounts[accountIndex].Balance += entry.AmountYNXT
		now := blockTime
		entry.Status = "withdrawn"
		entry.WithdrawnAt = &now
		entry.BlockHeight = height
		entry.TxHash = txHash
		entry.AuditHash = ""
		entry.AuditHash = stakingAuditHash(entry)
		state.unbondings[index] = entry
		recordID = entry.ID
	}
	return state, transactionExecution{typeName: tx.Type, event: abcitypes.Event{Type: "ynx.staking", Attributes: []abcitypes.EventAttribute{{Key: "action", Value: tx.Action, Index: true}, {Key: "signer", Value: tx.Signer, Index: true}, {Key: "record_id", Value: recordID, Index: true}}}}, nil
}

func (a *Application) activeValidator(address string) bool {
	for _, value := range a.migration.Validators {
		if value.Address == address && value.Active {
			return true
		}
	}
	return false
}
func stakingDelegationIndex(values []BFTStakeDelegation, id string) (int, bool) {
	index := sort.Search(len(values), func(i int) bool { return values[i].ID >= id })
	return index, index < len(values) && values[index].ID == id
}
func insertStakeDelegation(values []BFTStakeDelegation, value BFTStakeDelegation) []BFTStakeDelegation {
	index, _ := stakingDelegationIndex(values, value.ID)
	values = append(values, BFTStakeDelegation{})
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}
func unbondingIndex(values []BFTUnbondingEntry, id string) (int, bool) {
	index := sort.Search(len(values), func(i int) bool { return values[i].ID >= id })
	return index, index < len(values) && values[index].ID == id
}
func insertUnbonding(values []BFTUnbondingEntry, value BFTUnbondingEntry) []BFTUnbondingEntry {
	index, _ := unbondingIndex(values, value.ID)
	values = append(values, BFTUnbondingEntry{})
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}
func pendingUnbondingSupply(values []BFTUnbondingEntry) (int64, error) {
	var total int64
	for _, value := range values {
		if value.Status == "queued" {
			if total > math.MaxInt64-value.AmountYNXT {
				return 0, errors.New("unbonding supply overflow")
			}
			total += value.AmountYNXT
		}
	}
	return total, nil
}
func stakingRecordSummary(migration chain.ConsensusMigrationState, state CommittedState) map[string]any {
	byValidator := map[string]int64{}
	validators := make([]map[string]any, 0, len(migration.Validators))
	for _, validator := range migration.Validators {
		if !validator.Active {
			continue
		}
		ownStake := int64(0)
		if index, ok := accountIndex(migration.Accounts, validator.Address); ok {
			ownStake = migration.Accounts[index].Staked
		}
		byValidator[validator.Address] = ownStake
		validators = append(validators, map[string]any{"address": validator.Address, "moniker": validator.Moniker, "active": true, "votingPower": validator.VotingPower})
	}
	var delegated int64
	for _, value := range state.StakeDelegations {
		delegated += value.AmountYNXT
		byValidator[value.Validator] += value.AmountYNXT
	}
	var total, largest int64
	funded := 0
	for _, amount := range byValidator {
		total += amount
		if amount > largest {
			largest = amount
		}
		if amount > 0 {
			funded++
		}
	}
	largestBPS := int64(0)
	if total > 0 {
		largestBPS = largest * 10_000 / total
	}
	var accountStaked int64
	for _, account := range state.Accounts {
		accountStaked += account.Staked
	}
	unassigned := accountStaked - total
	if unassigned < 0 {
		unassigned = 0
	}
	coverageBPS := int64(0)
	if accountStaked > 0 {
		coverageBPS = (accountStaked - unassigned) * 10_000 / accountStaked
	}
	return map[string]any{"policyVersion": StakingPolicyVersion, "totalValidatorStakeYnxt": total, "totalDelegatedYnxt": delegated, "unassignedStakedYnxt": unassigned, "assignmentCoverageBps": coverageBPS, "byValidator": byValidator, "validatorCount": len(validators), "fundedValidatorCount": funded, "largestOperatorBps": largestBPS, "validators": validators, "performanceSource": "migration-validator-snapshot-not-live-telemetry", "performanceAsOfHeight": migration.Height, "commissionBps": StakingCommissionBPS, "rewardSource": "none_until_governed_issuance_activation", "unbondingSeconds": StakingUnbondingSeconds, "jailAndSlashing": "not_activated_requires_governance_authority", "yieldGuaranteed": false, "source": "ynx-consensus-abci", "version": fmt.Sprint(StakingPolicyVersion)}
}
