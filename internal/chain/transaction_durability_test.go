package chain

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"sync"
	"testing"
	"time"
)

func TestConcurrentCheckpointsMatchDiskAndColdReadDoesNotAttest(t *testing.T) {
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	in := nativeTransferInput()
	if _, err = d.Faucet(in.From, 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	if _, _, err = d.SubmitSignedTransfer(in); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	var wg sync.WaitGroup
	failures := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); failures <- d.persistSnapshot() }()
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatalf("concurrent shared temp path failed: %v", err)
		}
	}
	b, err := os.ReadFile(d.snapshotPath())
	if err != nil {
		t.Fatal(err)
	}
	var snapshot devnetSnapshot
	if err = json.Unmarshal(b, &snapshot); err != nil {
		t.Fatal(err)
	}
	_, proof, _ := d.TransactionWithDurability(in.Hash)
	if proof.Status != "durable" || proof.SnapshotIntegrity != snapshot.StateIntegrity {
		t.Fatal("published checkpoint disagrees with last durable file")
	}
	loaded := readTransferSnapshot(t, d)
	_, proof, _ = loaded.TransactionWithDurability(in.Hash)
	if proof.Status != "uncertain" {
		t.Fatal("reading bytes alone manufactured fsync evidence")
	}
	if err = loaded.persistSnapshot(); err != nil {
		t.Fatal(err)
	}
	_, proof, _ = loaded.TransactionWithDurability(in.Hash)
	if proof.Status != "durable" {
		t.Fatal("cold checkpoint did not establish local proof")
	}
}

func TestCheckpointCannotConfirmBlockWhileWriterWaits(t *testing.T) {
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	in := nativeTransferInput()
	if _, err = d.Faucet(in.From, 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	if _, _, err = d.SubmitSignedTransfer(in); err != nil {
		t.Fatal(err)
	}
	_, state, _ := d.TransactionWithDurability(in.Hash)
	if state.Status != "pending_durable" {
		t.Fatalf("admission status: %+v", state)
	}
	d.persistenceMu.Lock()
	done := make(chan struct{})
	go func() { d.ProduceBlock(); close(done) }()
	deadline := time.Now().Add(3 * time.Second)
	for {
		tx, proof, _ := d.TransactionWithDurability(in.Hash)
		if tx.BlockNum > 0 {
			if proof.Status != "uncertain" {
				d.persistenceMu.Unlock()
				<-done
				t.Fatalf("admission checkpoint confirmed unpersisted block: %+v", proof)
			}
			break
		}
		if time.Now().After(deadline) {
			d.persistenceMu.Unlock()
			<-done
			t.Fatal("producer never reached persistence boundary")
		}
		time.Sleep(time.Millisecond)
	}
	d.persistenceMu.Unlock()
	<-done
	tx, proof, _ := d.TransactionWithDurability(in.Hash)
	if proof.Status != "durable" || proof.CheckpointHeight < tx.BlockNum || proof.SnapshotIntegrity == "" {
		t.Fatalf("completed checkpoint: %+v", proof)
	}
	// Bind complete data, not just the same hash, height, or legacy header.
	d.mu.Lock()
	d.blocks[tx.BlockNum].Transactions[0].Amount++
	d.mu.Unlock()
	_, proof, _ = d.TransactionWithDurability(in.Hash)
	if proof.Status != "uncertain" {
		t.Fatal("checkpoint accepted altered same-hash transaction")
	}
}

func TestModuleReplayConfirmsMinedCheckpoint(t *testing.T) {
	for _, name := range []string{"dex", "resource-pool", "resource-sponsor"} {
		t.Run(name, func(t *testing.T) {
			var d *Devnet
			var submit moduleSubmit
			if name == "dex" {
				var in NativeDexSignedActionInput
				d, in = dexPersistenceFixture(t, NativeDexActionAssetCreate)
				submit = func(target *Devnet) (any, Transaction, error) {
					tx, m, _, err := target.SubmitNativeDexAction(in)
					return m.Event, tx, err
				}
			} else {
				action := ResourcePoolCreateAction
				if name == "resource-sponsor" {
					action = ResourceSponsorAction
				}
				d, submit = resourcePersistenceFixture(t, action)
			}
			_, tx, err := submit(d)
			if err != nil {
				t.Fatal(err)
			}
			clear := blockSnapshotWrite(t, d.snapshotPath()+".tmp")
			d.ProduceBlock()
			before := moduleBusinessState(t, d)
			if _, _, err = submit(d); !errors.Is(err, ErrSnapshotDurabilityUncertain) {
				t.Fatalf("mined replay skipped checkpoint: %v", err)
			}
			assertModuleState(t, d, before)
			clear()
			if _, _, err = submit(d); err != nil {
				t.Fatal(err)
			}
			assertModuleState(t, d, before)
			_, proof, _ := d.TransactionWithDurability(tx.Hash)
			if proof.Status != "durable" {
				t.Fatalf("recovered proof: %+v", proof)
			}
		})
	}
}

// An unrelated checkpoint must not revoke a completed write's proof for an
// unchanged transaction, even if the new write fails before or after rename.
func TestCompletedTransactionSurvivesLaterCheckpointFailure(t *testing.T) {
	for _, phase := range []string{"snapshot", "marker"} {
		t.Run(phase, func(t *testing.T) {
			d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			old, err := d.Faucet("durable-recipient", 100)
			if err != nil {
				t.Fatal(err)
			}
			d.ProduceBlock()
			_, before, _ := d.TransactionWithDurability(old.Hash)
			if before.Status != "durable" {
				t.Fatalf("fixture not durable: %+v", before)
			}
			newTx, err := d.Faucet("new-recipient", 100)
			if err != nil {
				t.Fatal(err)
			}
			_, before, _ = d.TransactionWithDurability(old.Hash)
			path := d.snapshotPath() + ".tmp"
			if phase == "marker" {
				path = d.snapshotIntegrityMarkerPath() + ".tmp"
			}
			clear := blockSnapshotWrite(t, path)
			defer clear()
			for range 3 {
				d.ProduceBlock()
				_, after, _ := d.TransactionWithDurability(old.Hash)
				if !reflect.DeepEqual(after, before) {
					t.Fatalf("later failed %s checkpoint revoked completed proof: before=%+v after=%+v", phase, before, after)
				}
				_, fresh, _ := d.TransactionWithDurability(newTx.Hash)
				if fresh.Status != "uncertain" {
					t.Fatalf("new inclusion attested before completed write: %+v", fresh)
				}
			}
			clear()
			if err := d.persistSnapshot(); err != nil {
				t.Fatal(err)
			}
			for _, hash := range []string{old.Hash, newTx.Hash} {
				_, proof, _ := d.TransactionWithDurability(hash)
				if proof.Status != "durable" {
					t.Fatalf("recovered checkpoint: %+v", proof)
				}
			}
		})
	}
}

func TestReplacementCheckpointRetainsOnlyUnchangedCompletedProof(t *testing.T) {
	for _, phase := range []string{"snapshot", "marker"} {
		for _, change := range []string{"unchanged", "removed", "same-hash-amount", "index", "earlier-fee", "later-fee", "pending"} {
			t.Run(phase+"/"+change, func(t *testing.T) {
				d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
				if err != nil {
					t.Fatal(err)
				}
				var target Transaction
				for _, address := range []string{"first", "target", "last"} {
					tx, err := d.Faucet(address, 100)
					if err != nil {
						t.Fatal(err)
					}
					if address == "target" {
						target = tx
					}
				}
				d.ProduceBlock()
				target, before, _ := d.TransactionWithDurability(target.Hash)
				previous := d.durableCheckpoint.Load()
				// Round-trip so the replacement fixture cannot mutate live state.
				d.mu.RLock()
				encoded, err := json.Marshal(d.snapshotLocked())
				d.mu.RUnlock()
				if err != nil {
					t.Fatal(err)
				}
				var candidate devnetSnapshot
				if err := json.Unmarshal(encoded, &candidate); err != nil {
					t.Fatal(err)
				}
				block := &candidate.Blocks[target.BlockNum]
				switch change {
				case "removed":
					block.Transactions = append(block.Transactions[:1], block.Transactions[2:]...)
				case "same-hash-amount":
					block.Transactions[1].Amount++
				case "index":
					block.Transactions[0], block.Transactions[1] = block.Transactions[1], block.Transactions[0]
				case "earlier-fee":
					block.Transactions[0].Fee++
				case "later-fee":
					block.Transactions[2].Fee++
				case "pending":
					pending := block.Transactions[1]
					pending.BlockNum, pending.BlockHash = 0, ""
					candidate.Pending = append(candidate.Pending, pending)
					block.Transactions = append(block.Transactions[:1], block.Transactions[2:]...)
				}
				candidate, err = sealDevnetSnapshot(candidate)
				if err != nil {
					t.Fatal(err)
				}
				path := d.snapshotPath() + ".tmp"
				if phase == "marker" {
					path = d.snapshotIntegrityMarkerPath() + ".tmp"
				}
				clear := blockSnapshotWrite(t, path)
				defer clear()
				if err := d.persistPreparedSnapshot(candidate); err == nil {
					t.Fatal("obstructed replacement succeeded")
				}
				_, after, _ := d.TransactionWithDurability(target.Hash)
				keep := change == "unchanged" || change == "later-fee"
				if keep {
					if !reflect.DeepEqual(after, before) {
						t.Fatalf("unchanged receipt context lost proof: before=%+v after=%+v", before, after)
					}
				} else if after.Status != "uncertain" {
					t.Fatalf("changed replacement kept stale proof: %+v", after)
				}
				if !checkpointCovers(previous, target) || len(previous.transactions) != 3 {
					t.Fatal("published previous checkpoint was mutated")
				}
				// A second failed write cannot restore a withdrawn proof, even if
				// it proposes the exact original transaction again.
				if err := d.persistSnapshot(); err == nil {
					t.Fatal("obstructed retry succeeded")
				}
				_, retry, _ := d.TransactionWithDurability(target.Hash)
				if !keep && retry.Status != "uncertain" {
					t.Fatalf("failed retry manufactured proof: %+v", retry)
				}
				clear()
				if err := d.persistSnapshot(); err != nil {
					t.Fatal(err)
				}
				_, recovered, _ := d.TransactionWithDurability(target.Hash)
				if recovered.Status != "durable" {
					t.Fatalf("completed replacement did not recover: %+v", recovered)
				}
			})
		}
	}
}
