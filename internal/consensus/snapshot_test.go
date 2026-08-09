package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abciclient "github.com/cometbft/cometbft/abci/client"
	abciserver "github.com/cometbft/cometbft/abci/server"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func TestApplicationStateSyncSnapshotRoundTripAndRestart(t *testing.T) {
	ctx := context.Background()
	migration, source, sender, recipient := stateSyncSourceApplication(t)
	sourceInfo, err := source.Info(ctx, &abcitypes.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	listed, err := source.ListSnapshots(ctx, &abcitypes.RequestListSnapshots{})
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Snapshots) != 1 {
		t.Fatalf("expected one current snapshot, got %d", len(listed.Snapshots))
	}
	snapshot := listed.Snapshots[0]
	if snapshot.Format != stateSyncSnapshotFormat || snapshot.Height != uint64(sourceInfo.LastBlockHeight) || snapshot.Chunks == 0 || len(snapshot.Hash) != 32 {
		t.Fatalf("unexpected snapshot descriptor: %+v", snapshot)
	}
	metadata, err := decodeStateSyncSnapshotMetadata(snapshot.Metadata)
	if err != nil {
		t.Fatal(err)
	}
	if metadata.Schema != stateSyncSnapshotSchema || metadata.StateVersion != CommittedStateVersion || metadata.Height != snapshot.Height || metadata.ChainID != migration.Network.ChainID || metadata.MigrationStateHash != migration.StateHash {
		t.Fatalf("unexpected snapshot metadata: %+v", metadata)
	}

	targetPath := filepath.Join(t.TempDir(), "restored", "ynx-abci-state.json")
	target, err := NewPersistentApplication(migration, targetPath)
	if err != nil {
		t.Fatal(err)
	}
	offer, err := target.OfferSnapshot(ctx, &abcitypes.RequestOfferSnapshot{Snapshot: cloneABCSnapshot(snapshot), AppHash: sourceInfo.LastBlockAppHash})
	if err != nil || offer.Result != abcitypes.ResponseOfferSnapshot_ACCEPT {
		t.Fatalf("snapshot offer failed: response=%+v err=%v", offer, err)
	}
	for index := uint32(0); index < snapshot.Chunks; index++ {
		loaded, err := source.LoadSnapshotChunk(ctx, &abcitypes.RequestLoadSnapshotChunk{Height: snapshot.Height, Format: snapshot.Format, Chunk: index})
		if err != nil || len(loaded.Chunk) == 0 {
			t.Fatalf("load snapshot chunk %d failed: response=%+v err=%v", index, loaded, err)
		}
		applied, err := target.ApplySnapshotChunk(ctx, &abcitypes.RequestApplySnapshotChunk{Index: index, Chunk: loaded.Chunk, Sender: "validator-source"})
		if err != nil || applied.Result != abcitypes.ResponseApplySnapshotChunk_ACCEPT {
			t.Fatalf("apply snapshot chunk %d failed: response=%+v err=%v", index, applied, err)
		}
	}

	targetInfo, err := target.Info(ctx, &abcitypes.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	if targetInfo.LastBlockHeight != sourceInfo.LastBlockHeight || !bytes.Equal(targetInfo.LastBlockAppHash, sourceInfo.LastBlockAppHash) {
		t.Fatalf("restored application identity differs: source=%+v target=%+v", sourceInfo, targetInfo)
	}
	for _, address := range []string{sender, recipient} {
		sourceAccount, err := source.Query(ctx, &abcitypes.RequestQuery{Path: "/accounts/" + address})
		if err != nil {
			t.Fatal(err)
		}
		targetAccount, err := target.Query(ctx, &abcitypes.RequestQuery{Path: "/accounts/" + address})
		if err != nil {
			t.Fatal(err)
		}
		if sourceAccount.Code != abcitypes.CodeTypeOK || targetAccount.Code != abcitypes.CodeTypeOK || !bytes.Equal(sourceAccount.Value, targetAccount.Value) {
			t.Fatalf("restored account %s differs: source=%s target=%s", address, sourceAccount.Value, targetAccount.Value)
		}
	}

	restarted, err := NewPersistentApplication(migration, targetPath)
	if err != nil {
		t.Fatal(err)
	}
	restartedInfo, err := restarted.Info(ctx, &abcitypes.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	if restartedInfo.LastBlockHeight != sourceInfo.LastBlockHeight || !bytes.Equal(restartedInfo.LastBlockAppHash, sourceInfo.LastBlockAppHash) {
		t.Fatalf("restored state did not survive restart: source=%+v restarted=%+v", sourceInfo, restartedInfo)
	}
	info, err := os.Stat(targetPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("restored state mode is %o, expected 600", info.Mode().Perm())
	}
}

func TestApplicationServesStateSyncSnapshotOverSocket(t *testing.T) {
	ctx := context.Background()
	migration, source, sender, recipient := stateSyncSourceApplication(t)
	targetPath := filepath.Join(t.TempDir(), "target", "state.json")
	target, err := NewPersistentApplication(migration, targetPath)
	if err != nil {
		t.Fatal(err)
	}
	sourceClient := stateSyncSocketClient(t, source, "source.sock")
	targetClient := stateSyncSocketClient(t, target, "target.sock")

	sourceInfo, err := sourceClient.Info(ctx, &abcitypes.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	listed, err := sourceClient.ListSnapshots(ctx, &abcitypes.RequestListSnapshots{})
	if err != nil || len(listed.Snapshots) != 1 {
		t.Fatalf("socket ListSnapshots failed: response=%+v err=%v", listed, err)
	}
	snapshot := listed.Snapshots[0]
	offer, err := targetClient.OfferSnapshot(ctx, &abcitypes.RequestOfferSnapshot{Snapshot: cloneABCSnapshot(snapshot), AppHash: sourceInfo.LastBlockAppHash})
	if err != nil || offer.Result != abcitypes.ResponseOfferSnapshot_ACCEPT {
		t.Fatalf("socket OfferSnapshot failed: response=%+v err=%v", offer, err)
	}
	for index := uint32(0); index < snapshot.Chunks; index++ {
		loaded, err := sourceClient.LoadSnapshotChunk(ctx, &abcitypes.RequestLoadSnapshotChunk{Height: snapshot.Height, Format: snapshot.Format, Chunk: index})
		if err != nil || len(loaded.Chunk) == 0 {
			t.Fatalf("socket LoadSnapshotChunk %d failed: response=%+v err=%v", index, loaded, err)
		}
		applied, err := targetClient.ApplySnapshotChunk(ctx, &abcitypes.RequestApplySnapshotChunk{Index: index, Chunk: loaded.Chunk, Sender: "source-peer"})
		if err != nil || applied.Result != abcitypes.ResponseApplySnapshotChunk_ACCEPT {
			t.Fatalf("socket ApplySnapshotChunk %d failed: response=%+v err=%v", index, applied, err)
		}
	}
	targetInfo, err := targetClient.Info(ctx, &abcitypes.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	if targetInfo.LastBlockHeight != sourceInfo.LastBlockHeight || !bytes.Equal(targetInfo.LastBlockAppHash, sourceInfo.LastBlockAppHash) {
		t.Fatalf("socket restored identity differs: source=%+v target=%+v", sourceInfo, targetInfo)
	}
	for _, address := range []string{sender, recipient} {
		sourceAccount, err := sourceClient.Query(ctx, &abcitypes.RequestQuery{Path: "/accounts/" + address})
		if err != nil {
			t.Fatal(err)
		}
		targetAccount, err := targetClient.Query(ctx, &abcitypes.RequestQuery{Path: "/accounts/" + address})
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(sourceAccount.Value, targetAccount.Value) {
			t.Fatalf("socket-restored account %s differs: source=%s target=%s", address, sourceAccount.Value, targetAccount.Value)
		}
	}
}

func TestApplicationStateSyncRejectsInvalidOfferAndTamperedChunk(t *testing.T) {
	ctx := context.Background()
	migration, source, _, _ := stateSyncSourceApplication(t)
	sourceInfo, err := source.Info(ctx, &abcitypes.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	listed, err := source.ListSnapshots(ctx, &abcitypes.RequestListSnapshots{})
	if err != nil || len(listed.Snapshots) != 1 {
		t.Fatalf("list snapshot failed: response=%+v err=%v", listed, err)
	}
	snapshot := listed.Snapshots[0]

	t.Run("format", func(t *testing.T) {
		target, err := NewPersistentApplication(migration, "")
		if err != nil {
			t.Fatal(err)
		}
		invalid := cloneABCSnapshot(snapshot)
		invalid.Format++
		response, err := target.OfferSnapshot(ctx, &abcitypes.RequestOfferSnapshot{Snapshot: invalid, AppHash: sourceInfo.LastBlockAppHash})
		if err != nil || response.Result != abcitypes.ResponseOfferSnapshot_REJECT_FORMAT {
			t.Fatalf("invalid format was not rejected: response=%+v err=%v", response, err)
		}
	})

	t.Run("metadata", func(t *testing.T) {
		target, err := NewPersistentApplication(migration, "")
		if err != nil {
			t.Fatal(err)
		}
		invalid := cloneABCSnapshot(snapshot)
		metadata, err := decodeStateSyncSnapshotMetadata(invalid.Metadata)
		if err != nil {
			t.Fatal(err)
		}
		metadata.ChainID++
		invalid.Metadata, err = json.Marshal(metadata)
		if err != nil {
			t.Fatal(err)
		}
		response, err := target.OfferSnapshot(ctx, &abcitypes.RequestOfferSnapshot{Snapshot: invalid, AppHash: sourceInfo.LastBlockAppHash})
		if err != nil || response.Result != abcitypes.ResponseOfferSnapshot_REJECT {
			t.Fatalf("foreign metadata was not rejected: response=%+v err=%v", response, err)
		}
	})

	t.Run("trusted-app-hash", func(t *testing.T) {
		target, err := NewPersistentApplication(migration, "")
		if err != nil {
			t.Fatal(err)
		}
		response, err := target.OfferSnapshot(ctx, &abcitypes.RequestOfferSnapshot{Snapshot: cloneABCSnapshot(snapshot), AppHash: make([]byte, 32)})
		if err != nil || response.Result != abcitypes.ResponseOfferSnapshot_REJECT {
			t.Fatalf("wrong trusted AppHash was not rejected: response=%+v err=%v", response, err)
		}
	})

	t.Run("chunk", func(t *testing.T) {
		targetPath := filepath.Join(t.TempDir(), "state.json")
		target, err := NewPersistentApplication(migration, targetPath)
		if err != nil {
			t.Fatal(err)
		}
		before, err := target.Info(ctx, &abcitypes.RequestInfo{})
		if err != nil {
			t.Fatal(err)
		}
		offer, err := target.OfferSnapshot(ctx, &abcitypes.RequestOfferSnapshot{Snapshot: cloneABCSnapshot(snapshot), AppHash: sourceInfo.LastBlockAppHash})
		if err != nil || offer.Result != abcitypes.ResponseOfferSnapshot_ACCEPT {
			t.Fatalf("valid snapshot offer failed: response=%+v err=%v", offer, err)
		}
		for index := uint32(0); index < snapshot.Chunks; index++ {
			loaded, err := source.LoadSnapshotChunk(ctx, &abcitypes.RequestLoadSnapshotChunk{Height: snapshot.Height, Format: snapshot.Format, Chunk: index})
			if err != nil {
				t.Fatal(err)
			}
			chunk := append([]byte(nil), loaded.Chunk...)
			if index == snapshot.Chunks-1 {
				chunk[len(chunk)-1] ^= 0x01
			}
			applied, err := target.ApplySnapshotChunk(ctx, &abcitypes.RequestApplySnapshotChunk{Index: index, Chunk: chunk, Sender: "tampered-source"})
			if err != nil {
				t.Fatal(err)
			}
			if index == snapshot.Chunks-1 && applied.Result != abcitypes.ResponseApplySnapshotChunk_REJECT_SNAPSHOT {
				t.Fatalf("tampered snapshot was not rejected: %+v", applied)
			}
		}
		after, err := target.Info(ctx, &abcitypes.RequestInfo{})
		if err != nil {
			t.Fatal(err)
		}
		if after.LastBlockHeight != before.LastBlockHeight || !bytes.Equal(after.LastBlockAppHash, before.LastBlockAppHash) {
			t.Fatalf("tampered snapshot changed target state: before=%+v after=%+v", before, after)
		}
		if _, err := os.Stat(targetPath); !os.IsNotExist(err) {
			t.Fatalf("tampered snapshot created durable state: %v", err)
		}
	})
}

func TestApplicationStateSyncPersistenceFailureAbortsWithoutMutation(t *testing.T) {
	ctx := context.Background()
	migration, source, _, _ := stateSyncSourceApplication(t)
	sourceInfo, err := source.Info(ctx, &abcitypes.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	listed, err := source.ListSnapshots(ctx, &abcitypes.RequestListSnapshots{})
	if err != nil || len(listed.Snapshots) != 1 {
		t.Fatalf("list snapshot failed: response=%+v err=%v", listed, err)
	}
	snapshot := listed.Snapshots[0]

	root := t.TempDir()
	stateDir := filepath.Join(root, "state-dir")
	statePath := filepath.Join(stateDir, "state.json")
	target, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	before, err := target.Info(ctx, &abcitypes.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stateDir, []byte("not-a-directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	offer, err := target.OfferSnapshot(ctx, &abcitypes.RequestOfferSnapshot{Snapshot: cloneABCSnapshot(snapshot), AppHash: sourceInfo.LastBlockAppHash})
	if err != nil || offer.Result != abcitypes.ResponseOfferSnapshot_ACCEPT {
		t.Fatalf("valid snapshot offer failed: response=%+v err=%v", offer, err)
	}
	for index := uint32(0); index < snapshot.Chunks; index++ {
		loaded, err := source.LoadSnapshotChunk(ctx, &abcitypes.RequestLoadSnapshotChunk{Height: snapshot.Height, Format: snapshot.Format, Chunk: index})
		if err != nil {
			t.Fatal(err)
		}
		applied, err := target.ApplySnapshotChunk(ctx, &abcitypes.RequestApplySnapshotChunk{Index: index, Chunk: loaded.Chunk, Sender: "validator-source"})
		if err != nil {
			t.Fatal(err)
		}
		if index == snapshot.Chunks-1 && applied.Result != abcitypes.ResponseApplySnapshotChunk_ABORT {
			t.Fatalf("persistence failure did not abort restore: %+v", applied)
		}
	}
	after, err := target.Info(ctx, &abcitypes.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	if after.LastBlockHeight != before.LastBlockHeight || !bytes.Equal(after.LastBlockAppHash, before.LastBlockAppHash) {
		t.Fatalf("failed persistence changed target state: before=%+v after=%+v", before, after)
	}
}

func stateSyncSocketClient(t *testing.T, app *Application, name string) abciclient.Client {
	t.Helper()
	socketPath := filepath.Join("/tmp", fmt.Sprintf("ynx-state-sync-%d-%s", os.Getpid(), name))
	_ = os.Remove(socketPath)
	t.Cleanup(func() { _ = os.Remove(socketPath) })
	address := "unix://" + socketPath
	server, err := abciserver.NewServer(address, "socket", app)
	if err != nil {
		t.Fatal(err)
	}
	if err := server.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Stop() })
	client, err := abciclient.NewClient(address, "socket", true)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Stop() })
	return client
}

func stateSyncSourceApplication(t *testing.T) (chain.ConsensusMigrationState, *Application, string, string) {
	t.Helper()
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	senderKey := deterministicPrivateKey(81)
	sender := mustNativeAddress(t, senderKey)
	recipient := mustNativeAddress(t, deterministicPrivateKey(82))
	if _, err := devnet.Faucet(sender, 1000); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	sourcePath := filepath.Join(t.TempDir(), "source", "ynx-abci-state.json")
	source, err := NewPersistentApplication(migration, sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	migrationPayload, err := migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := source.InitChain(ctx, &abcitypes.RequestInitChain{ChainId: "ynx_6423-1", InitialHeight: int64(migration.Height) + 1, AppStateBytes: migrationPayload}); err != nil {
		t.Fatal(err)
	}
	tx, err := NewSignedTransfer(senderKey, migration.Network.ChainID, recipient, 125, 1)
	if err != nil {
		t.Fatal(err)
	}
	txPayload, err := EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	height := int64(migration.Height) + 1
	finalized, err := source.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: time.Unix(1_750_000_000, 0).UTC(), Txs: [][]byte{txPayload}})
	if err != nil || len(finalized.TxResults) != 1 || finalized.TxResults[0].Code != abcitypes.CodeTypeOK {
		t.Fatalf("commit snapshot fixture transfer failed: response=%+v err=%v", finalized, err)
	}
	if _, err := source.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	return migration, source, sender, recipient
}
