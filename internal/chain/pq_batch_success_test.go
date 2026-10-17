package chain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// These are sequential correctness cases, not a throughput benchmark. Each
// Whole contains distinct consecutive nonces and every member must execute.
// Durability below means this node's checkpoint; it does not assert BFT finality.
func TestPQBatchAllMembersSuccessfulAndRestart(t *testing.T) {
	for _, n := range []int{1, 16, 64, 1024} {
		t.Run(fmt.Sprintf("N=%d", n), func(t *testing.T) {
			f := newPQLedger(t)
			funded, _ := f.d.Account(f.owner)
			// One migration fee, then N transfers with amount=1 and fee=1.
			// Use the actual faucet so both balance and provenance lots exist.
			required := int64(2*n + 1)
			if funded.Balance < required {
				_, err := f.d.Faucet(f.owner, required-funded.Balance)
				pqMust(t, err)
				funded, _ = f.d.Account(f.owner)
			}
			if funded.Balance < required {
				t.Fatal("fixture does not fund all member amounts and fees")
			}
			f.activate(t)
			beforeOwner, _ := f.d.Account(f.owner)
			beforeRecipient, _ := f.d.Account(f.to)
			feeAddress := f.d.nextValidatorAddressLocked()
			beforeFee, _ := f.d.Account(feeAddress)
			if beforeOwner.Nonce != 1 || beforeOwner.Balance != funded.Balance-1 || feeAddress == f.owner || feeAddress == f.to || len(f.d.pending) != 0 {
				t.Fatal("unexpected fixture activation or fee recipient")
			}
			transfers := make([]ynxauth.Transfer, n)
			for i := range transfers {
				transfers[i] = f.batchTransfer(uint64(i+2), 1)
			}
			wire := f.whole(t, transfers...)
			if len(wire) > MaxPQBatchBytes {
				t.Fatal("valid complete batch exceeds its request bound")
			}
			priorCheckpoint := f.d.durableCheckpoint.Load()
			if priorCheckpoint == nil {
				t.Fatal("fixture lacks a completed activation checkpoint")
			}
			out, err := f.d.SubmitPQBatch(wire)
			pqMust(t, err)
			if out.Status != "durable" || out.Replayed || out.BatchHash != pqBatchHash(wire) || out.ExecutionHeight != 2 || len(out.Results) != n || len(f.d.pending) != n || len(f.d.pqBatches) != 1 {
				t.Fatal("whole batch did not produce exactly N durable business results")
			}
			proof := f.d.pqBatches[out.BatchHash]
			if !bytes.Equal(proof.Whole, wire) || proof.Height != out.ExecutionHeight || !reflect.DeepEqual(proof.Results, out.Results) {
				t.Fatal("shared proof changed the complete original batch or outcomes")
			}
			// One immutable completed checkpoint covers all N successes. This
			// assertion does not claim instrumentation of filesystem write count.
			checkpoint := f.d.durableCheckpoint.Load()
			if checkpoint == nil || checkpoint == priorCheckpoint || checkpoint.integrity == "" || len(checkpoint.transactions) != len(priorCheckpoint.transactions)+n {
				t.Fatal("batch lacks one complete checkpoint containing all new members")
			}
			ownerLots, recipientLots := maps.Clone(beforeOwner.Lots), maps.Clone(beforeRecipient.Lots)
			if recipientLots == nil {
				recipientLots = map[string]int64{}
			}
			for i, result := range out.Results {
				hash, err := PQBatchTransactionHash(out.BatchHash, uint32(i))
				pqMust(t, err)
				if result.Index != uint32(i) || result.Outcome != "admitted" || result.Error != "" || result.TransactionHash != hash {
					t.Fatalf("member %d failed independent business admission: %+v", i, result)
				}
				tx, durability, found := f.d.TransactionWithDurability(hash)
				if !found || tx.Hash != hash || tx.Type != "transfer" || tx.From != f.owner || tx.To != f.to || tx.Amount != 1 || tx.Fee != 1 || tx.Nonce != uint64(i+2) || tx.BlockNum != 0 || tx.BlockHash != "" || tx.Memo != pqBatchMemberMemo(out.BatchHash, uint32(i)) || tx.Timestamp.IsZero() {
					t.Fatalf("member %d lost exact execution fields or stable proof reference", i)
				}
				if !checkpointCovers(checkpoint, tx) || checkpointCovers(priorCheckpoint, tx) || durability.Status != "pending_durable" || durability.SnapshotIntegrity != checkpoint.integrity || durability.ExecutionHeight != out.ExecutionHeight {
					t.Fatalf("member %d is not covered by the same completed checkpoint", i)
				}
				var moved int64
				for _, flow := range tx.LotFlows {
					if flow.From != f.owner || flow.To != f.to || flow.Amount <= 0 || ownerLots[flow.LotID] < flow.Amount {
						t.Fatalf("member %d omitted or invented original transfer provenance", i)
					}
					if _, exists := f.d.lots[flow.LotID]; !exists {
						t.Fatalf("member %d references absent provenance", i)
					}
					ownerLots[flow.LotID] -= flow.Amount
					recipientLots[flow.LotID] += flow.Amount
					moved += flow.Amount
				}
				if moved != tx.Amount {
					t.Fatalf("member %d moved %d lot units for amount %d", i, moved, tx.Amount)
				}
			}
			afterOwner, _ := f.d.Account(f.owner)
			afterRecipient, _ := f.d.Account(f.to)
			afterFee, _ := f.d.Account(feeAddress)
			if afterOwner.Balance != beforeOwner.Balance-int64(2*n) || afterOwner.Nonce != uint64(n+1) || afterOwner.ResourceUsage.BandwidthUsed != beforeOwner.ResourceUsage.BandwidthUsed+int64(n) || afterRecipient.Balance != beforeRecipient.Balance+int64(n) || afterRecipient.Nonce != beforeRecipient.Nonce || afterFee.Balance != beforeFee.Balance+int64(n) {
				t.Fatal("complete batch did not conserve member amounts, fees and nonces")
			}
			// Preserve the existing transfer model: LotFlows track the amount;
			// its fixed fee is an independent balance credit to the validator.
			if !reflect.DeepEqual(afterOwner.Lots, ownerLots) || !reflect.DeepEqual(afterRecipient.Lots, recipientLots) || !reflect.DeepEqual(afterFee.Lots, beforeFee.Lots) {
				t.Fatal("batch provenance differs from its exact per-member lot flows")
			}
			pendingSnapshot := pqBatchSuccessDiskSnapshot(t, f.d)
			diskCheckpoint, err := checkpointForSnapshot(pendingSnapshot)
			pqMust(t, err)
			if !reflect.DeepEqual(diskCheckpoint, checkpoint) || len(pendingSnapshot.Pending) != n || !reflect.DeepEqual(pendingSnapshot.PQBatches, f.d.pqBatches) {
				t.Fatal("disk checkpoint omits a member or duplicates/changes its shared proof")
			}
			replay, err := f.d.SubmitPQBatch(wire)
			pqMust(t, err)
			if !replay.Replayed || replay.Status != "durable" || !reflect.DeepEqual(replay.Results, out.Results) || f.d.durableCheckpoint.Load() != checkpoint || len(f.d.pending) != n {
				t.Fatal("exact batch replay changed completed results or consumed a new checkpoint")
			}
			block := f.d.ProduceBlock()
			if block.Height != out.ExecutionHeight || len(block.Transactions) != n || len(f.d.pending) != 0 {
				t.Fatal("produced block omitted members or retained pending duplicates")
			}
			pqBatchSuccessDiskSnapshot(t, f.d)
			restored, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
			pqMust(t, err)
			for address, want := range map[string]Account{f.owner: afterOwner, f.to: afterRecipient, feeAddress: afterFee} {
				got, ok := restored.Account(address)
				if !ok || !reflect.DeepEqual(got, want) {
					t.Fatalf("restart changed final account %s", address)
				}
			}
			if len(restored.pending) != 0 || len(restored.pqBatches) != 1 || !reflect.DeepEqual(restored.pqBatches[out.BatchHash], proof) {
				t.Fatal("restart lost original shared proof, outcomes or pending state")
			}
			for i, want := range block.Transactions {
				got, durability, found := restored.TransactionWithDurability(want.Hash)
				if !found || !reflect.DeepEqual(got, want) || got.Nonce != uint64(i+2) || got.BlockNum != block.Height || got.BlockHash != block.Hash || durability.Status != "durable" || len(durability.FeesThroughTransaction) != i+1 {
					t.Fatalf("restart lost complete member %d or its exact block inclusion", i)
				}
				for _, fee := range durability.FeesThroughTransaction {
					if fee != 1 {
						t.Fatal("restart changed the committed cumulative fee inputs")
					}
				}
			}
			restoredCheckpoint := restored.durableCheckpoint.Load()
			replay, err = restored.SubmitPQBatch(wire)
			pqMust(t, err)
			if !replay.Replayed || replay.Status != "durable" || !reflect.DeepEqual(replay.Results, out.Results) || restored.durableCheckpoint.Load() != restoredCheckpoint || len(restored.pending) != 0 {
				t.Fatal("cold replay re-executed a completed member")
			}
		})
	}
}

// Bound the test artifact before reading it. This is a per-test budget, not a
// new production ledger-history limit, and it also detects N copied Whole blobs.
func pqBatchSuccessDiskSnapshot(t *testing.T, d *Devnet) devnetSnapshot {
	t.Helper()
	info, err := os.Stat(d.snapshotPath())
	pqMust(t, err)
	if info.Size() <= 0 || info.Size() > 32<<20 {
		t.Fatalf("batch fixture checkpoint is outside its 32 MiB budget: %d", info.Size())
	}
	raw, err := os.ReadFile(d.snapshotPath())
	pqMust(t, err)
	var snapshot devnetSnapshot
	pqMust(t, json.Unmarshal(raw, &snapshot))
	return snapshot
}
