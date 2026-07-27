package chain

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
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

func TestReplicationBatchConvergesBlocksAndState(t *testing.T) {
	cfg := DefaultNetworkConfig("testnet")
	source := NewDevnet(cfg)
	if _, err := source.Faucet("ynx_replication_batch_alice", 250); err != nil {
		t.Fatal(err)
	}
	sourceBlock := source.ProduceBlock()
	genesis, _ := source.BlockByHeight(0)
	payload, err := source.ReplicationBatchJSON(genesis.Height, genesis.Hash)
	if err != nil {
		t.Fatal(err)
	}
	var encoded replicationBatch
	if err := json.Unmarshal(payload, &encoded); err != nil {
		t.Fatal(err)
	}
	if err := validateReplicationState(*encoded.State, cfg); err != nil {
		t.Fatalf("batch state integrity failed: %v", err)
	}

	destination, err := NewPersistentDevnet(cfg, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	result, err := destination.ApplyReplicationBatchJSON(payload)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Applied || destination.LatestBlock().Hash != sourceBlock.Hash {
		t.Fatalf("batch did not converge: %+v", result)
	}
	account, ok := destination.Account("ynx_replication_batch_alice")
	if !ok || account.Balance != 250 {
		t.Fatalf("replicated batch state missing: %+v %v", account, ok)
	}
}

func TestReplicationBatchCatchesUpInBoundedSuffixes(t *testing.T) {
	cfg := DefaultNetworkConfig("testnet")
	source := NewDevnet(cfg)
	for range MaxReplicationBatchBlocks + 2 {
		source.ProduceBlock()
	}
	destination := NewDevnet(cfg)
	local := destination.LatestBlock()
	firstPayload, err := source.ReplicationBatchJSON(local.Height, local.Hash)
	if err != nil {
		t.Fatal(err)
	}
	var first replicationBatch
	if err := json.Unmarshal(firstPayload, &first); err != nil {
		t.Fatal(err)
	}
	if first.Complete || first.State != nil || len(first.Blocks) != MaxReplicationBatchBlocks {
		t.Fatalf("first suffix was not bounded: complete=%t state=%t blocks=%d", first.Complete, first.State != nil, len(first.Blocks))
	}
	firstResult, err := destination.ApplyReplicationBatchJSON(firstPayload)
	if err != nil {
		t.Fatal(err)
	}
	if !firstResult.Applied || destination.LatestHeight() != MaxReplicationBatchBlocks {
		t.Fatalf("first suffix did not advance destination: %+v height=%d", firstResult, destination.LatestHeight())
	}

	local = destination.LatestBlock()
	finalPayload, err := source.ReplicationBatchJSON(local.Height, local.Hash)
	if err != nil {
		t.Fatal(err)
	}
	var final replicationBatch
	if err := json.Unmarshal(finalPayload, &final); err != nil {
		t.Fatal(err)
	}
	if !final.Complete || final.State == nil || len(final.Blocks) != 2 {
		t.Fatalf("final suffix did not carry bounded source state: complete=%t state=%t blocks=%d", final.Complete, final.State != nil, len(final.Blocks))
	}
	if _, err := destination.ApplyReplicationBatchJSON(finalPayload); err != nil {
		t.Fatal(err)
	}
	if destination.LatestBlock().Hash != source.LatestBlock().Hash {
		t.Fatal("bounded suffixes did not converge to authoritative tip")
	}
}

func TestReplicationBatchCheckpointsWithoutRewritingEverySuffix(t *testing.T) {
	cfg := DefaultNetworkConfig("testnet")
	source := NewDevnet(cfg)
	destinationDir := t.TempDir()
	destination, err := NewPersistentDevnet(cfg, destinationDir)
	if err != nil {
		t.Fatal(err)
	}
	applyNext := func() {
		t.Helper()
		local := destination.LatestBlock()
		payload, batchErr := source.ReplicationBatchJSON(local.Height, local.Hash)
		if batchErr != nil {
			t.Fatal(batchErr)
		}
		if _, batchErr = destination.ApplyReplicationBatchJSON(payload); batchErr != nil {
			t.Fatal(batchErr)
		}
	}
	durableHeight := func() uint64 {
		t.Helper()
		payload, readErr := os.ReadFile(filepath.Join(destinationDir, "devnet-state.json"))
		if readErr != nil {
			t.Fatal(readErr)
		}
		var snapshot devnetSnapshot
		if readErr = json.Unmarshal(payload, &snapshot); readErr != nil {
			t.Fatal(readErr)
		}
		return snapshot.Blocks[len(snapshot.Blocks)-1].Height
	}

	source.ProduceBlock()
	applyNext()
	if got := durableHeight(); got != 1 {
		t.Fatalf("first replication suffix was not checkpointed: height=%d", got)
	}
	source.ProduceBlock()
	applyNext()
	if destination.LatestHeight() != 2 || durableHeight() != 1 {
		t.Fatalf("small suffix rewrote the durable checkpoint: memory=%d durable=%d", destination.LatestHeight(), durableHeight())
	}

	destination.mu.Lock()
	destination.replicaCheckpoint.At = time.Now().UTC().Add(-replicationCheckpointInterval)
	destination.mu.Unlock()
	source.ProduceBlock()
	applyNext()
	if got := durableHeight(); got != 3 {
		t.Fatalf("time-bounded replication checkpoint did not advance: height=%d", got)
	}
}

func TestReplicationBatchRejectsTamperingBeforeMutation(t *testing.T) {
	source := NewDevnet(DefaultNetworkConfig("testnet"))
	source.ProduceBlock()
	destination := NewDevnet(DefaultNetworkConfig("testnet"))
	before := destination.LatestBlock()
	payload, err := source.ReplicationBatchJSON(before.Height, before.Hash)
	if err != nil {
		t.Fatal(err)
	}
	var batch replicationBatch
	if err := json.Unmarshal(payload, &batch); err != nil {
		t.Fatal(err)
	}
	batch.Blocks[0].Hash = strings.Repeat("0", sha256.Size*2)
	tampered, err := json.Marshal(batch)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := destination.ApplyReplicationBatchJSON(tampered); err == nil || !strings.Contains(err.Error(), "integrity mismatch") {
		t.Fatalf("expected batch integrity rejection, got %v", err)
	}
	after := destination.LatestBlock()
	if after.Height != before.Height || after.Hash != before.Hash {
		t.Fatal("tampered replication batch mutated destination")
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
	if err == nil || !strings.Contains(err.Error(), "state integrity mismatch") {
		t.Fatalf("expected hash mismatch, got %v", err)
	}
}

func TestReplicationSnapshotRejectsTamperedAccountState(t *testing.T) {
	source := NewDevnet(DefaultNetworkConfig("testnet"))
	if _, err := source.Faucet("ynx_replication_integrity", 100); err != nil {
		t.Fatal(err)
	}
	payload, err := source.ReplicationSnapshotJSON()
	if err != nil {
		t.Fatal(err)
	}
	var snapshot devnetSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatal(err)
	}
	snapshot.Accounts["ynx_replication_integrity"].Balance = 999
	payload, err = json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	destination := NewDevnet(DefaultNetworkConfig("testnet"))
	if _, err := destination.ApplyReplicationSnapshotJSON(payload, true); err == nil || !strings.Contains(err.Error(), "state integrity mismatch") {
		t.Fatalf("tampered replication account state was accepted: %v", err)
	}
	if _, ok := destination.Account("ynx_replication_integrity"); ok {
		t.Fatal("tampered replication state mutated the destination")
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

func TestReplicationSnapshotPersistenceFailureRestoresInMemoryState(t *testing.T) {
	cfg := DefaultNetworkConfig("testnet")
	source := NewDevnet(cfg)
	if _, err := source.Faucet("ynx_replication_atomic", 100); err != nil {
		t.Fatal(err)
	}
	source.ProduceBlock()
	payload, err := source.ReplicationSnapshotJSON()
	if err != nil {
		t.Fatal(err)
	}

	destination, err := NewPersistentDevnet(cfg, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	before := destination.LatestBlock()
	blockedParent := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blockedParent, []byte("blocked"), 0o600); err != nil {
		t.Fatal(err)
	}
	destination.dataDir = blockedParent
	if _, err := destination.ApplyReplicationSnapshotJSON(payload, true); err == nil || !strings.Contains(err.Error(), "persist replication snapshot") {
		t.Fatalf("replication persistence failure was not reported: %v", err)
	}
	if after := destination.LatestBlock(); after.Height != before.Height || after.Hash != before.Hash {
		t.Fatalf("failed replication changed in-memory block state: before=%+v after=%+v", before, after)
	}
	if _, ok := destination.Account("ynx_replication_atomic"); ok {
		t.Fatal("failed replication changed in-memory account state")
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
	if degraded.Status != "degraded" || !degraded.CatchingUp || degraded.Fresh || degraded.Failures != 1 || degraded.ConsecutiveFailures != 1 || degraded.LastErrorStage != "fetch response" || degraded.LastError != "temporary source failure with details" {
		t.Fatalf("unexpected degraded replication status: %+v", degraded)
	}

	latest := devnet.LatestBlock()
	devnet.RecordReplicationSuccess(ReplicationApplyResult{Height: latest.Height, BlockHash: latest.Hash, SnapshotAt: time.Now().UTC()})
	synced := devnet.NodeIdentity().Replication
	if synced.Status != "synced" || synced.CatchingUp || !synced.Fresh || synced.LocalHeight != synced.SourceHeight || synced.LocalBlockHash != synced.SourceBlockHash || synced.Successes != 1 || synced.Failures != 1 || synced.ConsecutiveFailures != 0 || synced.LastSuccessAt == nil || synced.LastSnapshotAt == nil || synced.LastError != "" {
		t.Fatalf("unexpected synced replication status: %+v", synced)
	}
	devnet.BeginReplicationAttempt()
	checking := devnet.NodeIdentity().Replication
	if checking.Status != "synced" || checking.CatchingUp || !checking.Fresh || checking.Attempts != 2 {
		t.Fatalf("healthy background replication check revoked last success: %+v", checking)
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
