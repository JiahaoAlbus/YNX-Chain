package consensus

import (
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestNativeTransferPreservesInputOnLotFailure(t *testing.T) {
	for _, lotBalance := range []int64{2, 3} {
		t.Run(map[int64]string{2: "partial_amount", 3: "fee_after_amount"}[lotBalance], func(t *testing.T) {
			key := deterministicPrivateKey(81)
			sender := mustNativeAddress(t, key)
			receiver := mustNativeAddress(t, deterministicPrivateKey(82))
			app := &Application{migration: chain.ConsensusMigrationState{Network: chain.DefaultNetworkConfig("testnet")}, feeRecipient: "ynx_validator_fee"}
			// Deliberately inconsistent lot coverage exercises a late failure,
			// after account insertion and a partial lot movement have occurred.
			state := executionState{accounts: []chain.ConsensusAccount{{Address: sender, Balance: 100, Lots: map[string]int64{"lot": lotBalance}}}}
			state = cloneExecutionStateValue(state)
			state.feeEvents = feeEventJournal{base: make([]BFTFeeEvent, 1, 8)}
			state.feeEvents.base[0] = BFTFeeEvent{ID: "existing"}
			before := cloneExecutionStateValue(state)
			tx, err := NewSignedTransfer(key, 6423, receiver, 3, 1)
			if err != nil {
				t.Fatal(err)
			}
			raw, err := EncodeSignedTransaction(tx)
			if err != nil {
				t.Fatal(err)
			}
			if _, _, err := app.applyTransaction(state, raw, 2, time.Unix(100, 0)); err == nil {
				t.Fatal("transaction with insufficient traceable lots succeeded")
			}
			if !reflect.DeepEqual(state, before) {
				t.Fatal("failed transaction changed its input state")
			}
		})
	}
}

func TestNativeTransferBranchesPreserveAccountsAndFeeHistory(t *testing.T) {
	for _, feeTarget := range []string{"separate", "sender", "receiver"} {
		t.Run(feeTarget, func(t *testing.T) {
			key := deterministicPrivateKey(83)
			sender := mustNativeAddress(t, key)
			receiver := mustNativeAddress(t, deterministicPrivateKey(84))
			fee := map[string]string{"separate": "ynx_validator_fee", "sender": sender, "receiver": receiver}[feeTarget]
			app := &Application{migration: chain.ConsensusMigrationState{Network: chain.DefaultNetworkConfig("testnet")}, feeRecipient: fee}
			state := executionState{accounts: []chain.ConsensusAccount{{Address: sender, Balance: 100, Lots: map[string]int64{"lot": 100}}}}
			state = cloneExecutionStateValue(state)
			state.feeEvents = feeEventJournal{base: make([]BFTFeeEvent, 1, 8)}
			state.feeEvents.base[0] = BFTFeeEvent{ID: "existing"}
			before := cloneExecutionStateValue(state)
			apply := func(amount int64) executionState {
				tx, err := NewSignedTransfer(key, 6423, receiver, amount, 1)
				if err != nil {
					t.Fatal(err)
				}
				raw, err := EncodeSignedTransaction(tx)
				if err != nil {
					t.Fatal(err)
				}
				next, _, err := app.applyTransaction(state, raw, 2, time.Unix(100, 0))
				if err != nil {
					t.Fatal(err)
				}
				return next
			}
			first := apply(3)
			firstBefore := cloneExecutionStateValue(first)
			second := apply(7)
			if !reflect.DeepEqual(state, before) || !reflect.DeepEqual(cloneExecutionStateValue(first), firstBefore) {
				t.Fatal("successful branch changed its input or sibling state")
			}
			for i, next := range []executionState{first, second} {
				next = cloneExecutionStateValue(next) // inspect the canonical account/lot state
				amount := []int64{3, 7}[i]
				si, _ := accountIndex(next.accounts, sender)
				ri, _ := accountIndex(next.accounts, receiver)
				wantSender, wantReceiver := int64(100)-amount-1, amount
				if fee == sender {
					wantSender++
				}
				if fee == receiver {
					wantReceiver++
				}
				if next.accounts[si].Balance != wantSender || next.accounts[si].Lots["lot"] != wantSender || next.accounts[si].Nonce != 1 || next.accounts[si].ResourceUsage.BandwidthUsed != 1 || next.accounts[ri].Balance != wantReceiver || next.accounts[ri].Lots["lot"] != wantReceiver {
					t.Fatalf("incorrect transfer balances/nonce/lots: %+v", next.accounts)
				}
				var total int64
				for _, account := range next.accounts {
					total += account.Balance
				}
				if total != 100 || len(next.feeEvents.events()) != 2 || next.feeEvents.events()[0].ID != "existing" || next.feeEvents.events()[1].GrossFeeYNXT != 1 {
					t.Fatal("supply or fee history changed")
				}
			}
			if first.feeEvents.events()[1].TxHash == second.feeEvents.events()[1].TxHash {
				t.Fatal("sibling fee events overwrote one another")
			}
		})
	}
}
