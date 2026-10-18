package consensus

import (
	"errors"
	"math"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func validateStakingState(state CommittedState, migration chain.ConsensusMigrationState) error {
	validators := make(map[string]bool, len(migration.Validators))
	for _, value := range migration.Validators {
		validators[value.Address] = value.Active
	}
	delegatedByAccount := map[string]int64{}
	previous := ""
	for _, value := range state.StakeDelegations {
		if !trustRecordIDPattern.MatchString(value.ID) || (previous != "" && value.ID <= previous) || !IsNativeAddress(value.Delegator) || !validators[value.Validator] || value.AmountYNXT < 0 || value.CommissionBPS != StakingCommissionBPS || value.RewardSource != "none_until_governed_issuance_activation" || (value.Status != "active" && value.Status != "unbonded") || (value.AmountYNXT == 0) != (value.Status == "unbonded") || value.CreatedAt.IsZero() || value.UpdatedAt.Before(value.CreatedAt) || value.BlockHeight <= 0 || value.TxHash == "" || value.AuditHash != stakingAuditHash(value) {
			return errors.New("committed staking delegations must be canonical, active-validator-bound, and audit-complete")
		}
		if delegatedByAccount[value.Delegator] > math.MaxInt64-value.AmountYNXT {
			return errors.New("delegated stake overflow")
		}
		delegatedByAccount[value.Delegator] += value.AmountYNXT
		previous = value.ID
	}
	for delegator, amount := range delegatedByAccount {
		index, ok := accountIndex(state.Accounts, delegator)
		if !ok || state.Accounts[index].Staked < amount {
			return errors.New("delegation records exceed delegator staked balance")
		}
	}
	previous = ""
	for _, value := range state.Unbondings {
		if !trustRecordIDPattern.MatchString(value.ID) || (previous != "" && value.ID <= previous) || !trustRecordIDPattern.MatchString(value.DelegationID) || !IsNativeAddress(value.Delegator) || strings.TrimSpace(value.Validator) == "" || value.AmountYNXT <= 0 || value.RequestedAt.IsZero() || !value.AvailableAt.Equal(value.RequestedAt.Add(time.Duration(StakingUnbondingSeconds)*time.Second)) || value.BlockHeight <= 0 || value.TxHash == "" || value.AuditHash != stakingAuditHash(value) {
			return errors.New("committed unbonding entries must be canonical and audit-complete")
		}
		if value.Status == "queued" {
			if value.WithdrawnAt != nil {
				return errors.New("queued unbonding cannot have withdrawal time")
			}
		} else if value.Status == "withdrawn" {
			if value.WithdrawnAt == nil || value.WithdrawnAt.Before(value.AvailableAt) {
				return errors.New("withdrawn unbonding requires post-availability time")
			}
		} else {
			return errors.New("unsupported unbonding status")
		}
		previous = value.ID
	}
	return nil
}
