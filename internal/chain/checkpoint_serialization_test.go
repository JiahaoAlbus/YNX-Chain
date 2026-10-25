package chain

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"
)

func TestCheckpointSerializedAndMeasuredShareDurableState(t *testing.T) {
	bounded := func(name string, call func() error) {
		t.Helper()
		done := make(chan error, 1)
		go func() { done <- call() }()
		timer := time.NewTimer(5 * time.Second)
		defer timer.Stop()
		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
		case <-timer.C:
			t.Fatalf("%s did not return; checkpoint serialization may have reacquired its own lock", name)
		}
	}
	var d *Devnet
	var receipt Transaction
	var block Block
	directory := t.TempDir()
	configuration := DefaultNetworkConfig("testnet")
	bounded("normal constructor, Faucet and block checkpoint", func() error {
		var err error
		d, err = NewPersistentDevnet(configuration, directory)
		if err != nil {
			return err
		}
		receipt, err = d.Faucet("checkpoint-serialization-recipient", 100)
		if err != nil {
			return err
		}
		block = d.ProduceBlock()
		return nil
	})
	owner, found := d.Account(receipt.To)
	if !found || owner.Balance != receipt.Amount || owner.Nonce != 0 {
		t.Fatal("normal Faucet setup did not preserve its account")
	}
	original, proof, found := d.TransactionWithDurability(receipt.Hash)
	if !found || proof.Status != "durable" || original.BlockNum != block.Height || original.BlockHash != block.Hash {
		t.Fatal("normal committed Faucet has no complete original durability proof")
	}
	bounded("normal detached checkpoint", d.persistSnapshot)
	assertWrittenCheckpoint := func(m PQSnapshotMeasurement, lockAttempts uint64) {
		t.Helper()
		pqAssertPhase(t, m.CheckpointBuild, 1, 1, 0)
		pqAssertPhase(t, m.PersistenceLockWait, lockAttempts, lockAttempts, 0)
		pqAssertPhase(t, m.Mkdir, 1, 1, 0)
		pqAssertWrittenFile(t, m.SnapshotFile, d.snapshotPath())
		pqAssertWrittenFile(t, m.MarkerFile, d.snapshotIntegrityMarkerPath())
		raw, err := os.ReadFile(d.snapshotPath())
		if err != nil {
			t.Fatal(err)
		}
		var snapshot devnetSnapshot
		if err := json.Unmarshal(raw, &snapshot); err != nil {
			t.Fatal(err)
		}
		if err := validateDevnetSnapshotIntegrity(snapshot); err != nil {
			t.Fatal("measured writer did not preserve the actual durable snapshot", err)
		}
		checkpoint, published := d.durableCheckpoint.Load(), m.Published
		if checkpoint == nil || published == nil || published.Version != TransactionDurabilityVersion || published.Height != block.Height || published.Hash != block.Hash || published.Height != checkpoint.height || published.Hash != checkpoint.hash || published.SnapshotIntegrity != checkpoint.integrity || published.SnapshotIntegrity != snapshot.StateIntegrity {
			t.Fatal("published measurement differs from the actual final checkpoint and file")
		}
		if snapshot.Accounts[receipt.To] == nil || !reflect.DeepEqual(*snapshot.Accounts[receipt.To], owner) {
			t.Fatal("checkpoint entry points changed the funded account")
		}
		transaction, durable, exists := d.TransactionWithDurability(receipt.Hash)
		if !exists || durable.Status != "durable" || !reflect.DeepEqual(transaction, original) || durable.CheckpointHeight != published.Height || durable.CheckpointHash != published.Hash || durable.SnapshotIntegrity != published.SnapshotIntegrity {
			t.Fatal("measured checkpoint lost the exact original transaction proof")
		}
	}
	var measured PQSnapshotMeasurement
	bounded("locked mutator measured checkpoint", func() error {
		d.mu.Lock()
		defer d.mu.Unlock()
		return d.persistSnapshotLockedMeasured(&measured)
	})
	for _, phase := range []PQPhaseMeasurement{measured.Total, measured.SnapshotBuild, measured.IntegritySeal} {
		pqAssertPhase(t, phase, 1, 1, 0)
	}
	assertWrittenCheckpoint(measured, 1)
	if measured.CandidateIntegrity != measured.Published.SnapshotIntegrity {
		t.Fatal("measured mutator published a different candidate integrity")
	}
	var serialized PQSnapshotMeasurement
	bounded("already serialized measured writer", func() error {
		return d.persistSnapshotWithWriter(func(snapshot devnetSnapshot) error {
			return d.persistPreparedSnapshotSerializedMeasured(snapshot, &serialized)
		})
	})
	// The outer periodic entry already owns persistenceMu. The inner writer
	// measures real checkpoint/file work, without inventing a second lock wait
	// or claiming to have built and sealed the outer entry's snapshot itself.
	for _, phase := range []PQPhaseMeasurement{serialized.Total, serialized.SnapshotBuild, serialized.IntegritySeal} {
		pqAssertPhase(t, phase, 0, 0, 0)
	}
	assertWrittenCheckpoint(serialized, 0)
	var cold *Devnet
	bounded("normal cold constructor", func() error {
		var err error
		cold, err = NewPersistentDevnet(configuration, directory)
		return err
	})
	restored, found := cold.Account(receipt.To)
	if !found || !reflect.DeepEqual(restored, owner) {
		t.Fatal("cold constructor changed original balance, nonce, resources or lots")
	}
	transaction, durable, found := cold.TransactionWithDurability(receipt.Hash)
	if !found || durable.Status != "durable" || !reflect.DeepEqual(transaction, original) || durable.ExecutionHeight != proof.ExecutionHeight || durable.CheckpointHeight != block.Height || durable.CheckpointHash != block.Hash || !reflect.DeepEqual(durable.FeesThroughTransaction, proof.FeesThroughTransaction) {
		t.Fatal("cold constructor lost exact original transaction durability")
	}
}
