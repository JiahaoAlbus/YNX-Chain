package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	db "github.com/cometbft/cometbft-db"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/syndtr/goleveldb/leveldb/opt"
)

// Explicit offline inspection of a completed isolated window. No RPC, node
// process or persistent write to the application/blockstore is performed.
func TestStoppedNetworkReplay(t *testing.T) {
	work := os.Getenv("YNX_CHAIN_STOPPED_WINDOW")
	if work == "" {
		t.Skip("set YNX_CHAIN_STOPPED_WINDOW to an isolated stopped window")
	}
	read := func(file string, target any) []byte {
		t.Helper()
		raw, err := readBounded(file, 16*1024*1024)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(raw, target); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	manifestPath := filepath.Join(work, "network", "network-manifest.json")
	var m consensus.EphemeralNetworkManifest
	read(manifestPath, &m)
	if err := validateManifest(m); err != nil {
		t.Fatal(err)
	}
	if err := validateLocalPaths(m, manifestPath); err != nil {
		t.Fatal(err)
	}
	migration, err := readMigration(m)
	if err != nil {
		t.Fatal(err)
	}
	trusted, err := loadTrustedValidators(m)
	if err != nil {
		t.Fatal(err)
	}
	var result report
	resultRaw := read(filepath.Join(work, "transactions-result.json"), &result)
	var receipt struct {
		AllGroupsGone bool    `json:"allGroupsGone"`
		FirstCause    *string `json:"firstCause"`
	}
	read(filepath.Join(work, "window-receipt.json"), &receipt)
	if !receipt.AllGroupsGone || receipt.FirstCause != nil || len(result.SetupErrors) != 0 {
		t.Fatal("window did not complete cleanly")
	}
	inputRaw, err := readBounded(filepath.Join(work, "network", "transactions.json"), 8*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	txs, err := decodeTransactions(inputRaw)
	if err != nil {
		t.Fatal(err)
	}
	if result.Summary.FinalSubmitted != len(txs) {
		t.Fatal("incomplete final submission count")
	}
	expected := map[string]bool{}
	for _, tx := range txs {
		expected[hex.EncodeToString(tx.Hash())] = true
	}
	type proof struct {
		Height       int64            `json:"height"`
		Header       *cmttypes.Header `json:"header"`
		Commit       *cmttypes.Commit `json:"commit"`
		Transactions cmttypes.Txs     `json:"transactions"`
	}
	type nodeResult struct {
		Name                 string `json:"name"`
		Height               int64  `json:"height"`
		AppHash              string `json:"appHash"`
		SnapshotSHA256       string `json:"snapshotSha256"`
		ReplayedTransactions int    `json:"replayedTransactions"`
		ReadOnlyBlockstore   bool   `json:"readOnlyBlockstore"`
		ExactStateEqual      bool   `json:"exactStateEqual"`
	}
	var nodes []nodeResult
	var proofs []proof
	var expectedSnapshot []byte
	for index, node := range m.Nodes {
		var state consensus.CommittedState
		snapshotRaw := read(node.ABCIStatePath, &state)
		if err := state.Validate(migration); err != nil {
			t.Fatal(err)
		}
		if len(state.FeeEvents) != len(txs) || state.Height <= int64(migration.Height) || state.Height-int64(migration.Height) > 128 {
			t.Fatal("state is outside bounded window")
		}
		if expectedSnapshot == nil {
			expectedSnapshot = snapshotRaw
		} else if !bytes.Equal(expectedSnapshot, snapshotRaw) {
			t.Fatal("stopped node snapshots differ")
		}
		replay, err := consensus.NewApplication(migration)
		if err != nil {
			t.Fatal(err)
		}
		database, err := db.NewGoLevelDBWithOpts("blockstore", filepath.Join(node.Home, "data"), &opt.Options{ReadOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		blocks := store.NewBlockStore(database)
		seen := map[string]bool{}
		for height := int64(migration.Height) + 1; height <= state.Height; height++ {
			block := blocks.LoadBlock(height)
			if block == nil {
				t.Fatalf("missing committed block %d", height)
			}
			commit := blocks.LoadBlockCommit(height)
			if commit == nil {
				commit = blocks.LoadSeenCommit(height)
			}
			if commit == nil {
				t.Fatalf("missing commit %d", height)
			}
			signed := cmttypes.SignedHeader{Header: &block.Header, Commit: commit}
			if err := signed.ValidateBasic(m.ChainID); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(block.Header.ValidatorsHash, trusted.Hash()) {
				t.Fatal("block validator set differs from genesis")
			}
			if err := trusted.VerifyCommitLight(m.ChainID, commit.BlockID, height, commit); err != nil {
				t.Fatal(err)
			}
			info, err := replay.Info(context.Background(), &abcitypes.RequestInfo{})
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(info.LastBlockAppHash, block.Header.AppHash) {
				t.Fatalf("signed prior-state AppHash mismatch at %d", height)
			}
			for _, tx := range block.Data.Txs {
				hash := hex.EncodeToString(tx.Hash())
				if !expected[hash] || seen[hash] {
					t.Fatal("unexpected or duplicate committed transaction")
				}
				seen[hash] = true
			}
			finalized, err := replay.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: height, Time: block.Time, Txs: block.Data.Txs.ToSliceOfBytes()})
			if err != nil {
				t.Fatal(err)
			}
			for _, execution := range finalized.TxResults {
				if execution.Code != 0 {
					t.Fatalf("offline transaction replay rejected: %+v", execution)
				}
			}
			if _, err := replay.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			if index == 0 {
				proofs = append(proofs, proof{Height: height, Header: &block.Header, Commit: commit, Transactions: block.Data.Txs})
			}
		}
		if err := database.Close(); err != nil {
			t.Fatal(err)
		}
		if len(seen) != len(expected) {
			t.Fatal("committed workload was incomplete")
		}
		query, err := replay.Query(context.Background(), &abcitypes.RequestQuery{Path: "/state"})
		if err != nil || query.Code != 0 {
			t.Fatalf("replayed state query: %+v %v", query, err)
		}
		canonical, err := json.Marshal(state)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(canonical, query.Value) {
			t.Fatal("full replayed state differs from durable state")
		}
		sum := sha256.Sum256(snapshotRaw)
		nodes = append(nodes, nodeResult{Name: node.Moniker, Height: state.Height, AppHash: state.AppHash, SnapshotSHA256: hex.EncodeToString(sum[:]), ReplayedTransactions: len(seen), ReadOnlyBlockstore: true, ExactStateEqual: true})
	}
	resultSum := sha256.Sum256(resultRaw)
	output := struct {
		Schema            int          `json:"schema"`
		VerifiedAt        time.Time    `json:"verifiedAt"`
		ObservationSHA256 string       `json:"observationSha256"`
		Nodes             []nodeResult `json:"nodes"`
		Proofs            []proof      `json:"publicSignedBlocks"`
		Interpretation    string       `json:"interpretation"`
	}{1, time.Now().UTC(), hex.EncodeToString(resultSum[:]), nodes, proofs, "Offline read-only blockstore signature verification and exact application replay. No additional network TPS or restart result is inferred; final same-height state also has local durability evidence."}
	encoded, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(filepath.Join(work, "stopped-replay.json"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(append(encoded, '\n')); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	t.Logf("four stopped nodes: signed blocks verified, %d transactions per node replayed, complete state byte-equal", len(expected))
}
