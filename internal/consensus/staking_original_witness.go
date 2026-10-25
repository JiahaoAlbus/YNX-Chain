package consensus

import (
	"bytes"
	"errors"
	"math"
	"reflect"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// ValidateLegacyStakingOriginals verifies public original transactions against
// the caller's existing committed state. It neither authenticates that state
// independently nor creates permission to execute a new action. Normal PQ
// admission separately verifies the current Member and exact next nonce.
func ValidateLegacyStakingOriginals(state CommittedState, migration chain.ConsensusMigrationState, owner string, originals [][]byte) error {
	active := func(address string) bool {
		for _, validator := range migration.Validators {
			if validator.Address == address && validator.Active {
				return true
			}
		}
		return false
	}
	if state.ChainID != migration.Network.ChainID {
		return errors.New("classic staking witness chain differs from original migration")
	}
	i, ok := accountIndex(state.Accounts, owner)
	if !ok {
		return errors.New("classic staking witness owner is absent")
	}
	recipient := ""
	for _, validator := range migration.Validators {
		if validator.Active {
			recipient = validator.Address
			break
		}
	}
	baseline, err := replayLegacyStakingOriginals(owner, state.ChainID, state.AccountPolicy, state.FeeEvents, originals, state.Height, state.Accounts[i].Nonce, recipient, active)
	if err != nil {
		return err
	}
	for _, original := range baseline.stakeDelegations {
		index, exists := stakingDelegationIndex(state.StakeDelegations, original.ID)
		if !exists {
			return errors.New("classic staking witness lost its committed delegation")
		}
		current := state.StakeDelegations[index]
		want := baseline
		if current.AuthorizationHistory != "" {
			events, err := decodeStakingAuthorizations(current.AuthorizationHistory)
			if err != nil {
				return err
			}
			_, _, carried, err := DecodePQStakingActionTransaction(events[0].Transport)
			if err != nil || !sameStakingOriginals(carried, originals) {
				return errors.New("classic staking witness differs from previously committed originals")
			}
			want, _, err = replayStakingAuthorization(current, state.AccountPolicy, state.ChainID, active, state.FeeEvents, recipient)
			if err != nil {
				return err
			}
		} else if !reflect.DeepEqual(current, original) {
			return errors.New("classic staking witness differs from the existing opaque delegation")
		}
		if !reflect.DeepEqual(stakingUnbondingsFor(state.Unbondings, original.ID), stakingUnbondingsFor(want.unbondings, original.ID)) {
			return errors.New("classic staking witness differs from existing queued or withdrawn funds")
		}
	}
	for _, current := range state.StakeDelegations {
		if current.Delegator != owner || current.AuthorizationHistory != "" {
			continue
		}
		if _, ok := stakingDelegationIndex(baseline.stakeDelegations, current.ID); !ok {
			return errors.New("opaque delegation has no original successful classic creation")
		}
	}
	for _, current := range state.Unbondings {
		if current.Delegator != owner {
			continue
		}
		if _, ok := stakingDelegationIndex(baseline.stakeDelegations, current.DelegationID); !ok {
			index, found := stakingDelegationIndex(state.StakeDelegations, current.DelegationID)
			if !found || state.StakeDelegations[index].AuthorizationHistory == "" {
				return errors.New("opaque unbonding has no complete original successful history")
			}
		}
	}
	return nil
}

func sameStakingOriginals(a, b [][]byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if !bytes.Equal(a[i], b[i]) {
			return false
		}
	}
	return true
}

func stakingUnbondingsFor(values []BFTUnbondingEntry, delegation string) []BFTUnbondingEntry {
	var out []BFTUnbondingEntry
	for _, value := range values {
		if value.DelegationID == delegation {
			out = append(out, value)
		}
	}
	return out
}

func legacyStakingFees(values []BFTFeeEvent, owner string) []BFTFeeEvent {
	var out []BFTFeeEvent
	for _, fee := range values {
		if fee.Payer == owner && isStakingAction(fee.TransactionType) {
			out = append(out, fee)
		}
	}
	return out
}

// A successful original classic dispatcher appended these exact fee events
// only after executing the business action. They supply H/time; untrusted
// witness bytes do not. Complete owner coverage prevents cherry-picking a
// delegation's latest record while hiding earlier unbonds or withdrawals.
// This is a record arithmetic replay, not reconstruction of all historical
// liquid balances. The local accumulator never credits the actual ledger.
func replayLegacyStakingOriginals(owner string, chainID int64, policy *ynxauth.State, allFees []BFTFeeEvent, originals [][]byte, height int64, nonce uint64, recipient string, active func(string) bool) (executionState, error) {
	fees := legacyStakingFees(allFees, owner)
	if !IsNativeAddress(owner) || len(originals) == 0 || len(originals) != len(fees) || recipient == "" {
		return executionState{}, errors.New("classic staking needs complete original bytes and existing successful fees")
	}
	replay := executionState{accounts: []chain.ConsensusAccount{{Address: owner, Balance: math.MaxInt64}}}
	var previousNonce uint64
	totalBytes := 0
	seen := map[string]bool{}
	for i, raw := range originals {
		if len(raw) > MaxPQContractTransactionBytes-totalBytes {
			return executionState{}, errors.New("classic staking original bytes exceed the existing action transport bound")
		}
		totalBytes += len(raw)
		tx, err := DecodeSignedApplicationAction(raw)
		if err != nil {
			return executionState{}, err
		}
		if err = tx.Verify(chainID); err != nil {
			return executionState{}, err
		}
		fee := fees[i]
		hash := ApplicationActionHash(raw)
		if tx.Signer != owner || !isStakingAction(tx.Action) || tx.Nonce <= previousNonce || tx.Nonce > nonce || seen[hash] || fee.TxHash != hash || fee.BlockHeight <= 0 || fee.BlockHeight > height || fee.RecordedAt.IsZero() || i > 0 && (fee.BlockHeight < fees[i-1].BlockHeight || fee.RecordedAt.Before(fees[i-1].RecordedAt)) {
			return executionState{}, errors.New("classic staking original owner, order, height, nonce or successful hash differs")
		}
		if fee != newCurrentFeeEvent(hash, tx.Action, owner, recipient, SignedActionFeeYNXT, fee.BlockHeight, fee.RecordedAt) {
			return executionState{}, errors.New("classic staking original fee differs from original execution")
		}
		if err = requireConsensusLegacy(policy, owner, fee.BlockHeight); err != nil {
			return executionState{}, err
		}
		auth := authorizedStakingAction{Signer: owner, Action: tx.Action, Payload: tx.Payload}
		replay, _, err = applyAuthorizedStakingBusiness(replay, auth, hash, fee.BlockHeight, fee.RecordedAt, false, active)
		if err != nil {
			return executionState{}, err
		}
		seen[hash], previousNonce = true, tx.Nonce
	}
	return replay, nil
}
