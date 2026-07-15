package chain

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
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

func TestReplicationRuntimeStatusLifecycle(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("testnet"))
	producer := devnet.NodeIdentity().Replication
	if producer.Configured || producer.Status != "not_configured" || producer.CatchingUp || !producer.Fresh {
		t.Fatalf("unexpected producer replication status: %+v", producer)
	}

	devnet.SetNodeIdentityConfig(NodeIdentityConfig{
		ValidatorAddress:  "ynx_validator_singapore",
		ReplicationMode:   "authoritative_follower",
		ReplicationSource: "http://127.0.0.1:6420/",
		PeerSyncInterval:  5 * time.Second,
	})
	starting := devnet.NodeIdentity().Replication
	if !starting.Configured || starting.Source != "http://127.0.0.1:6420" || starting.Status != "starting" || !starting.CatchingUp || starting.Fresh {
		t.Fatalf("unexpected starting replication status: %+v", starting)
	}

	devnet.BeginReplicationAttempt()
	syncing := devnet.NodeIdentity().Replication
	if syncing.Status != "syncing" || syncing.Attempts != 1 || syncing.LastAttemptAt == nil || !syncing.CatchingUp {
		t.Fatalf("unexpected syncing replication status: %+v", syncing)
	}

	devnet.RecordReplicationFailure("fetch response", errors.New("temporary source failure\nwith details"))
	degraded := devnet.NodeIdentity().Replication
	if degraded.Status != "degraded" || !degraded.CatchingUp || degraded.Fresh || degraded.ConsecutiveFailures != 1 || degraded.LastErrorStage != "fetch response" || degraded.LastError != "temporary source failure with details" {
		t.Fatalf("unexpected degraded replication status: %+v", degraded)
	}

	latest := devnet.LatestBlock()
	devnet.RecordReplicationSuccess(ReplicationApplyResult{Height: latest.Height, BlockHash: latest.Hash, SnapshotAt: time.Now().UTC()})
	synced := devnet.NodeIdentity().Replication
	if synced.Status != "synced" || synced.CatchingUp || !synced.Fresh || synced.LocalHeight != synced.SourceHeight || synced.LocalBlockHash != synced.SourceBlockHash || synced.Successes != 1 || synced.ConsecutiveFailures != 0 || synced.LastSuccessAt == nil || synced.LastSnapshotAt == nil || synced.LastError != "" {
		t.Fatalf("unexpected synced replication status: %+v", synced)
	}

	devnet.mu.Lock()
	old := time.Now().UTC().Add(-time.Minute)
	devnet.replicationRuntime.LastSuccessAt = &old
	devnet.mu.Unlock()
	stale := devnet.NodeIdentity().Replication
	if stale.Status != "stale" || !stale.CatchingUp || stale.Fresh {
		t.Fatalf("unexpected stale replication status: %+v", stale)
	}

	devnet.StopReplicationRuntime()
	stopped := devnet.NodeIdentity().Replication
	if stopped.Status != "stopped" || !stopped.CatchingUp || stopped.Fresh {
		t.Fatalf("unexpected stopped replication status: %+v", stopped)
	}
}
