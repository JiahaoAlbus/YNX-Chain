package chain

import (
	"errors"
	"fmt"
	"testing"
)

func batchInputs(n int) []FaucetRequestInput {
	in := make([]FaucetRequestInput, n)
	for i := range in {
		in[i] = FaucetRequestInput{Address: fmt.Sprintf("ynx_batch_%02d", i), Amount: 100, RequestID: fmt.Sprintf("batch_%032d", i)}
	}
	return in
}
func TestFaucetBatchDurableDistinctRecipientsAndReplay(t *testing.T) {
	dir := t.TempDir()
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	before := d.accounts[FaucetAddress].Balance
	in := batchInputs(50)
	got := d.FaucetRequestsBatch(in)
	for i, r := range got {
		if r.Err != nil || r.Replayed {
			t.Fatalf("%d: %+v", i, r)
		}
		_, state, _ := d.TransactionWithDurability(r.Transaction.Hash)
		if state.Status != "pending_durable" {
			t.Fatal(state)
		}
	}
	if d.accounts[FaucetAddress].Balance != before-5000 {
		t.Fatal("funding supply mismatch")
	}
	cold, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	for i, r := range cold.FaucetRequestsBatch(in) {
		if r.Err != nil || !r.Replayed || r.Transaction.Hash != got[i].Transaction.Hash || cold.accounts[in[i].Address].Balance != 100 {
			t.Fatal("cold retry changed funded transaction")
		}
	}
}
func TestFaucetBatchDuplicateConflictAndPersistenceFailure(t *testing.T) {
	for _, afterRename := range []bool{false, true} {
		t.Run(fmt.Sprint(afterRename), func(t *testing.T) {
			dir := t.TempDir()
			d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir)
			if err != nil {
				t.Fatal(err)
			}
			before := d.accounts[FaucetAddress].Balance
			in := batchInputs(4)
			in = append(in, in[0])
			conflict := in[0]
			conflict.Amount++
			in = append(in, conflict)
			path := d.snapshotPath() + ".tmp"
			if afterRename {
				path = d.snapshotIntegrityMarkerPath() + ".tmp"
			}
			clear := blockSnapshotWrite(t, path)
			got := d.FaucetRequestsBatch(in)
			if !errors.Is(got[5].Err, ErrFaucetRequestConflict) {
				t.Fatal("conflicting duplicate accepted")
			}
			for _, r := range got[:5] {
				if r.Err == nil || errors.Is(r.Err, ErrSnapshotDurabilityUncertain) != afterRename {
					t.Fatalf("wrong failure: %+v", r)
				}
			}
			if afterRename {
				if d.accounts[FaucetAddress].Balance != before-400 || len(d.pending) != 4 {
					t.Fatal("uncertain batch duplicated or rolled back")
				}
			} else {
				if d.accounts[FaucetAddress].Balance != before || len(d.pending) != 0 {
					t.Fatal("batch rollback incomplete")
				}
				for _, v := range in {
					if d.accounts[v.Address] != nil {
						t.Fatal("failed batch leaked account")
					}
				}
			}
			clear()
			cold, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir)
			if err != nil {
				t.Fatal(err)
			}
			got = cold.FaucetRequestsBatch(in[:4])
			for _, r := range got {
				if r.Err != nil || r.Replayed != afterRename {
					t.Fatal("restart lost exact acceptance status")
				}
			}
			if cold.accounts[FaucetAddress].Balance != before-400 {
				t.Fatal("cold retry minted twice")
			}
		})
	}
}
