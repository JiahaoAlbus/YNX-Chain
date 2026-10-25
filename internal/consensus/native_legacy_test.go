package consensus

import (
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

// Frozen native execution/clone oracle from 8a57bca88, before sparse updates.
func legacyNativeApply(a *Application, state executionState, payload []byte, height int64, blockTime time.Time) (executionState, transactionExecution, error) {
	tx, err := a.decodeVerifiedNativeTransaction(payload)
	if err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	accounts := state.accounts
	senderIndex, ok := accountIndex(accounts, tx.From)
	if !ok {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("signed transaction sender account does not exist"))
	}
	sender := accounts[senderIndex]
	if sender.Nonce == math.MaxUint64 {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidNonce, errors.New("signed transaction sender nonce is exhausted"))
	}
	expectedNonce := sender.Nonce + 1
	if tx.Nonce != expectedNonce {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidNonce, fmt.Errorf("signed transaction nonce %d must equal next account nonce %d", tx.Nonce, expectedNonce))
	}
	if tx.Amount > math.MaxInt64-tx.Fee || sender.Balance < tx.Amount+tx.Fee {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("insufficient YNXT balance for amount and fee"))
	}
	if sender.ResourceUsage.BandwidthUsed == math.MaxInt64 {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("sender bandwidth usage overflow"))
	}
	// Native transfers only change these accounts and append a fee event.
	// Isolate them before either lot movement: even the fee movement can fail
	// after the amount has moved. Other application records remain read-only.
	state = legacyNativeTransferClone(state, tx.From, tx.To, a.feeRecipient)
	accounts = state.accounts
	accounts, _ = ensureAccount(accounts, tx.To)
	accounts, _ = ensureAccount(accounts, a.feeRecipient)
	senderIndex, _ = accountIndex(accounts, tx.From)
	receiverIndex, _ := accountIndex(accounts, tx.To)
	feeIndex, _ := accountIndex(accounts, a.feeRecipient)
	if err := moveTraceableLots(&accounts[senderIndex], &accounts[receiverIndex], tx.Amount); err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
	}
	if err := moveTraceableLots(&accounts[senderIndex], &accounts[feeIndex], tx.Fee); err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
	}
	accounts[senderIndex].Balance -= tx.Amount + tx.Fee
	accounts[senderIndex].Nonce++
	accounts[senderIndex].ResourceUsage.BandwidthUsed++
	accounts[receiverIndex].Balance += tx.Amount
	accounts[feeIndex].Balance += tx.Fee
	state.accounts = accounts
	state.feeEvents = state.feeEvents.append(newCurrentFeeEvent(SignedTransactionHash(payload), tx.Type, tx.From, a.feeRecipient, tx.Fee, height, blockTime))
	return state, transactionExecution{typeName: tx.Type, event: abcitypes.Event{Type: "ynx.transfer", Attributes: []abcitypes.EventAttribute{{Key: "sender", Value: tx.From, Index: true}, {Key: "recipient", Value: tx.To, Index: true}, {Key: "amount", Value: fmt.Sprint(tx.Amount), Index: true}}}}, nil
}

func legacyNativeTransferClone(state executionState, addresses ...string) executionState {
	// Copy the slice because ensureAccount may insert and shift its elements.
	// Lots is the only reference field in ConsensusAccount; clone it for each
	// unique account this transaction can modify, including aliased fee payees.
	state.accounts = append([]chain.ConsensusAccount(nil), state.accounts...)
	for i, address := range addresses {
		duplicate := false
		for _, previous := range addresses[:i] {
			if previous == address {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		if index, exists := accountIndex(state.accounts, address); exists {
			lots := state.accounts[index].Lots
			state.accounts[index].Lots = make(map[string]int64, len(lots))
			for id, amount := range lots {
				state.accounts[index].Lots[id] = amount
			}
		}
	}
	// Fee history and pending nodes are immutable and safe to share.
	return state
}
