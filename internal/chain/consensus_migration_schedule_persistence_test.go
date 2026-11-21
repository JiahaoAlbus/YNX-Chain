package chain

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// This exercises ordinary local persistence using an isolated synthetic copy.
// It does not establish a stopped public source, an operator pin or authority.
func TestConsensusSchedulePersistedCopyColdRestartPreservesOriginal(t *testing.T) {
	cfg := DefaultNetworkConfig("testnet")
	originalDir := t.TempDir()
	d, err := NewPersistentDevnet(cfg, originalDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.Faucet("ynx_schedule_owner", 100); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Transfer("ynx_schedule_owner", "ynx_schedule_recipient", 7); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	const source = "pragma solidity ^0.8.24; contract Persisted { event PersistedEvent(address indexed actor, uint256 amount); }"
	if _, _, err := d.DeployContract("ynx_schedule_owner", "Persisted", source); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	before, err := ExportConsensusMigrationCheckpoint(originalDir)
	if err != nil || before.AccountPolicy != nil || before.Runtime == nil || len(before.Runtime.Contracts) != 1 {
		t.Fatal("original synthetic checkpoint not complete", err)
	}
	original := captureOfflineConsensusSource(t, originalDir)
	copyDir := t.TempDir()
	for _, name := range []string{"devnet-state.json", "devnet-state.integrity-version"} {
		raw, err := os.ReadFile(filepath.Join(originalDir, name))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(copyDir, name), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	copyBefore, err := ExportConsensusMigrationCheckpoint(copyDir)
	if err != nil || !bytes.Equal(ownedMigrationJSON(t, copyBefore), ownedMigrationJSON(t, before)) {
		t.Fatal("independent copied source differs before scheduling", err)
	}
	copyNode, err := NewPersistentDevnet(cfg, copyDir)
	if err != nil {
		t.Fatal(err)
	}
	admissionHeight := before.Height + 100
	if err := copyNode.EnableAccountPQ(admissionHeight); err != nil {
		t.Fatal(err)
	}
	cold, err := NewPersistentDevnet(cfg, copyDir)
	if err != nil {
		t.Fatal(err)
	}
	after, err := ExportConsensusMigrationCheckpoint(copyDir)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyConsensusPQSchedulePreservation(before, after, admissionHeight); err != nil {
		t.Fatal("scheduled cold copy failed complete state preservation", err)
	}
	if err := cold.EnableAccountPQ(admissionHeight + 1); err == nil {
		t.Fatal("cold restart allowed existing schedule rewrite")
	}
	if err := cold.EnableAccountPQ(admissionHeight); err != nil {
		t.Fatal("cold restart rejected the identical existing schedule", err)
	}
	again, err := ExportConsensusMigrationCheckpoint(copyDir)
	if err != nil || !bytes.Equal(ownedMigrationJSON(t, after), ownedMigrationJSON(t, again)) {
		t.Fatal("same schedule changed complete cold checkpoint", err)
	}
	original.assertUnchanged(t)
}
