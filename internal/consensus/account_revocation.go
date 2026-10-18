package consensus

import (
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"reflect"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

// applyPQRevocation consumes the current lawful pair's original proof. The
// policy helper verifies both signatures, exact execution height, full key and
// revision schedule, next nonce and H+1 terminal boundary before any mutation.
// All balance, lot, fee and policy changes below belong to the detached candidate.
func (a *Application) applyPQRevocation(state executionState, wire []byte, nativeHash, abciHash string, height int64, blockTime time.Time) (executionState, chain.Transaction, transactionExecution, error) {
	fail := func(err error) (executionState, chain.Transaction, transactionExecution, error) {
		return executionState{}, chain.Transaction{}, transactionExecution{}, err
	}
	revocation, err := ynxauth.DecodeRevocation(wire)
	if err != nil {
		return fail(err)
	}
	owner := revocation.Intent.Owner
	index, exists := accountIndex(state.accounts, owner)
	if !exists {
		return fail(errors.New("PQ revocation owner account does not exist"))
	}
	next, err := state.accountPolicy.AdmitRevocation(revocation, uint64(height), state.accounts[index].Nonce)
	if err != nil {
		return fail(err)
	}
	state.accounts = cloneAccounts(state.accounts)
	state.accounts, _ = ensureAccount(state.accounts, a.feeRecipient)
	index, _ = accountIndex(state.accounts, owner)
	feeIndex, _ := accountIndex(state.accounts, a.feeRecipient)
	sender, recipient := &state.accounts[index], &state.accounts[feeIndex]
	if sender.Balance < 1 || sender.ResourceUsage.BandwidthUsed == math.MaxInt64 {
		return fail(errors.New("insufficient PQ revocation fee or bandwidth"))
	}
	if index != feeIndex && recipient.Balance == math.MaxInt64 {
		return fail(errors.New("PQ revocation fee recipient overflow"))
	}
	// A fee of one chooses exactly one positive lot, in the same deterministic
	// order as the source ledger. Self-payment still records the actual flow.
	var flow chain.LotFlow
	for _, lotID := range sortedLotKeys(sender.Lots) {
		if sender.Lots[lotID] > 0 {
			flow = chain.LotFlow{LotID: lotID, Amount: 1, From: owner, To: a.feeRecipient}
			break
		}
	}
	if flow.LotID == "" {
		return fail(errors.New("insufficient traceable PQ revocation fee"))
	}
	lot, exists := state.traceLots[flow.LotID]
	if !exists || lot.LotID != flow.LotID {
		return fail(errors.New("PQ revocation fee lacks original trace lineage"))
	}
	if index != feeIndex && recipient.Lots[flow.LotID] == math.MaxInt64 {
		return fail(errors.New("PQ revocation fee lot overflow"))
	}
	sender.Lots[flow.LotID]--
	recipient.Lots[flow.LotID]++
	sender.Balance--
	recipient.Balance++
	sender.Nonce = revocation.Intent.LedgerNonce
	sender.ResourceUsage.BandwidthUsed++
	state.traceLots = cloneTraceLots(state.traceLots)
	lot.LastInbound = a.feeRecipient
	state.traceLots[flow.LotID] = lot
	state.accountPolicy = &next
	state.feeEvents = append(append([]BFTFeeEvent(nil), state.feeEvents...), newCurrentFeeEvent(abciHash, PQRevocationType, owner, a.feeRecipient, 1, height, blockTime))
	tx := chain.Transaction{Hash: nativeHash, Type: PQRevocationType, From: owner, To: owner, Fee: 1, Nonce: revocation.Intent.LedgerNonce, LotFlows: []chain.LotFlow{flow}, Memo: pqRevocationMemo + hex.EncodeToString(wire)}
	executed := transactionExecution{typeName: PQRevocationType, hash: abciHash, event: abcitypes.Event{Type: "ynx.account_revocation", Attributes: []abcitypes.EventAttribute{{Key: "owner", Value: owner, Index: true}, {Key: "through_revision", Value: fmt.Sprint(revocation.Intent.ThroughRevision)}, {Key: "revoked_from", Value: fmt.Sprint(revocation.Intent.RevokeAt)}}}}
	return state, tx, executed, nil
}

func validateConsensusRevocationEffects(state CommittedState, migration chain.ConsensusMigrationState, entry PQCommittedAuthorization) error {
	tx := entry.Transaction
	feeRecipient := ""
	for _, validator := range migration.Validators {
		if validator.Active {
			feeRecipient = validator.Address
			break
		}
	}
	if tx.Timestamp.IsZero() || tx.Timestamp.Location() != time.UTC || len(tx.LotFlows) != 1 {
		return errors.New("ABCI revocation lacks original execution time or exact fee lot flow")
	}
	flow := tx.LotFlows[0]
	if flow.Amount != 1 || flow.From != tx.From || flow.To != feeRecipient || flow.LotID == "" {
		return errors.New("ABCI revocation fee flow differs from executed authorization")
	}
	if lot, exists := state.TraceLots[flow.LotID]; !exists || lot.LotID != flow.LotID {
		return errors.New("ABCI revocation fee flow has no source lineage")
	}
	index, exists := accountIndex(state.Accounts, tx.From)
	if !exists || state.Accounts[index].Nonce < tx.Nonce {
		return errors.New("ABCI revocation nonce was not consumed")
	}
	expected := newCurrentFeeEvent(entry.ABCITransactionHash, PQRevocationType, tx.From, feeRecipient, 1, int64(tx.BlockNum), tx.Timestamp)
	count := 0
	for _, event := range state.FeeEvents {
		if event.TxHash == entry.ABCITransactionHash {
			count++
			if event != expected {
				return errors.New("ABCI revocation fee event contradicts its original transaction")
			}
		}
	}
	if count != 1 {
		return errors.New("ABCI revocation requires exactly one executed fee event")
	}
	return nil
}

// Compare each live transition as well as validating it against the immutable
// migration anchor. Removing both a later tombstone and its proof is not a valid
// local transition, even if the shortened candidate has a newly calculated hash.
func validateConsensusPQContinuation(previous, next CommittedState) error {
	if err := chain.ValidateConsensusAccountPolicyContinuation(previous.AccountPolicy, next.AccountPolicy); err != nil {
		return err
	}
	if len(next.PQHistory) < len(previous.PQHistory) {
		return errors.New("ABCI authorization history cannot shrink")
	}
	for hash, proof := range previous.PQBatches {
		nextProof, exists := next.PQBatches[hash]
		if !exists || !reflect.DeepEqual(proof, nextProof) {
			return errors.New("ABCI Whole proof or original partial results cannot be removed or rewritten")
		}
	}
	for i, prior := range previous.PQHistory {
		if !reflect.DeepEqual(prior, next.PQHistory[i]) {
			return errors.New("ABCI authorization history cannot be rewritten")
		}
	}
	return nil
}

func clonePQHistory(input []PQCommittedAuthorization) []PQCommittedAuthorization {
	if input == nil {
		return nil
	}
	out := append([]PQCommittedAuthorization{}, input...)
	for i := range out {
		if input[i].Transaction.LotFlows != nil {
			out[i].Transaction.LotFlows = append([]chain.LotFlow{}, input[i].Transaction.LotFlows...)
		}
		if input[i].Transaction.Logs != nil {
			out[i].Transaction.Logs = append([]chain.EVMLog{}, input[i].Transaction.Logs...)
			for j := range out[i].Transaction.Logs {
				if input[i].Transaction.Logs[j].Topics != nil {
					out[i].Transaction.Logs[j].Topics = append([]string{}, input[i].Transaction.Logs[j].Topics...)
				}
			}
		}
	}
	return out
}
