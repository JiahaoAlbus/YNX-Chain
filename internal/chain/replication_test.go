package chain

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestReplicationSnapshotConvergesBlocksAndState(t *testing.T) {
	cfg := DefaultNetworkConfig("testnet")
	source := NewDevnet(cfg)
	if _, err := source.Faucet("ynx_replication_alice", 250); err != nil {
		t.Fatal(err)
	}
	sourceBlock := source.ProduceBlock()
	payload, err := source.ReplicationSnapshotJSON()
	if err != nil {
		t.Fatal(err)
	}

	destinationDir := t.TempDir()
	destination, err := NewPersistentDevnet(cfg, destinationDir)
	if err != nil {
		t.Fatal(err)
	}
	destination.ProduceBlock()
	result, err := destination.ApplyReplicationSnapshotJSON(payload, true)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Applied || result.Height != sourceBlock.Height || result.BlockHash != sourceBlock.Hash {
		t.Fatalf("unexpected replication result: %+v", result)
	}
	account, ok := destination.Account("ynx_replication_alice")
	if !ok || account.Balance != 250 {
		t.Fatalf("replicated account state missing: %+v %v", account, ok)
	}
	if destination.LatestBlock().Hash != source.LatestBlock().Hash {
		t.Fatal("destination did not converge to source block hash")
	}

	reloaded, err := NewPersistentDevnet(cfg, destinationDir)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.LatestBlock().Hash != sourceBlock.Hash {
		t.Fatal("replicated state did not survive restart")
	}
	noChange, err := reloaded.ApplyReplicationSnapshotJSON(payload, false)
	if err != nil {
		t.Fatal(err)
	}
	if noChange.Applied {
		t.Fatal("identical replication snapshot should not be reapplied")
	}
}

func TestReplicationSnapshotRejectsTamperedBlock(t *testing.T) {
	source := NewDevnet(DefaultNetworkConfig("testnet"))
	source.ProduceBlock()
	payload, err := source.ReplicationSnapshotJSON()
	if err != nil {
		t.Fatal(err)
	}
	var snapshot devnetSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatal(err)
	}
	snapshot.Blocks[1].Hash = "0xtampered"
	payload, err = json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	destination := NewDevnet(DefaultNetworkConfig("testnet"))
	_, err = destination.ApplyReplicationSnapshotJSON(payload, true)
	if err == nil || !strings.Contains(err.Error(), "identity is invalid") {
		t.Fatalf("expected hash mismatch, got %v", err)
	}
}

func TestReplicationSnapshotRejectsRollbackAfterBootstrap(t *testing.T) {
	cfg := DefaultNetworkConfig("testnet")
	older := NewDevnet(cfg)
	older.ProduceBlock()
	oldPayload, err := older.ReplicationSnapshotJSON()
	if err != nil {
		t.Fatal(err)
	}
	destination := NewDevnet(cfg)
	destination.ProduceBlock()
	destination.ProduceBlock()
	_, err = destination.ApplyReplicationSnapshotJSON(oldPayload, false)
	if err == nil || !strings.Contains(err.Error(), "behind local height") {
		t.Fatalf("expected rollback rejection, got %v", err)
	}
}
