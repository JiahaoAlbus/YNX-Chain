package chain

import (
	"encoding/json"
	"errors"
	"os"
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
