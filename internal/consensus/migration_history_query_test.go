package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

func migrationHistoryRead(t *testing.T, app *Application, path string) []byte {
	t.Helper()
	response, err := app.Query(context.Background(), &abci.RequestQuery{Path: path})
	if err != nil || response.Code != 0 || len(response.Value) == 0 || response.Height != app.committed.Height {
		t.Fatal("original source history query failed", path, response, err)
	}
	return response.Value
}

func assertMigrationHistoryAnchor(t *testing.T, got MigrationHistoryAnchor, migration chain.ConsensusMigrationState) {
	t.Helper()
	want := MigrationHistoryAnchor{Version: MigrationHistoryVersion, Source: "source_import", SourceAnchor: migration.StateHash, OriginalGenesisHash: migration.OriginalGenesisHash, MigrationBlockHash: migration.LastBlockHash, NativeChainID: migration.Network.ChainID, MigrationHeight: migration.Height}
	if got != want {
		t.Fatal("source history substituted an original import anchor", got, want)
	}
}

func TestMigrationHistoryQueryPreservesOriginalBlocksTransactionsAndAbsence(t *testing.T) {
	f := newApplicationInitializationFixture(t)
	app, err := NewPersistentApplicationWithBootstrap(f.migration, "", f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	originalMigration, originalState := mustJSON(t, app.migration), mustJSON(t, app.committed)
	for _, block := range f.migration.Runtime.Blocks {
		raw := migrationHistoryRead(t, app, MigrationHistoryBlockPath+strconv.FormatUint(block.Height, 10))
		var view MigrationHistoryBlockView
		if err := json.Unmarshal(raw, &view); err != nil || !view.Found || view.Block == nil || !reflect.DeepEqual(*view.Block, block) {
			t.Fatal("source block lost original fields, transaction order or genesis height zero", block.Height, err)
		}
		assertMigrationHistoryAnchor(t, view.MigrationHistoryAnchor, f.migration)
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil || string(fields["nativeChainId"]) != `"6423"` || string(fields["migrationHeight"]) != strconv.Quote(strconv.FormatUint(f.migration.Height, 10)) {
			t.Fatal("source anchor heights/chain ID are not canonical JSON strings", err)
		}
		for _, forbidden := range []string{"appHash", "cometIndex", "commitResult", "independentFinality"} {
			if _, found := fields[forbidden]; found {
				t.Fatal("source block invented Comet or finality evidence", forbidden)
			}
		}
	}
	originalTx, found := sourceHistoryTransaction(f.migration, f.history)
	if !found {
		t.Fatal("fixture lacks an actual original native transfer")
	}
	var transaction MigrationHistoryTransactionView
	if err := json.Unmarshal(migrationHistoryRead(t, app, MigrationHistoryTransactionPath+f.history), &transaction); err != nil || !transaction.Found || transaction.Transaction == nil || !reflect.DeepEqual(*transaction.Transaction, originalTx) {
		t.Fatal("source transaction changed its original hash, execution fields or policy data", err)
	}
	assertMigrationHistoryAnchor(t, transaction.MigrationHistoryAnchor, f.migration)
	for _, height := range []string{strconv.FormatUint(f.migration.Height+1, 10), "18446744073709551615"} {
		var absent MigrationHistoryBlockView
		if err := json.Unmarshal(migrationHistoryRead(t, app, MigrationHistoryBlockPath+height), &absent); err != nil || absent.Found || absent.Block != nil {
			t.Fatal("unknown source block did not return explicit absence", height, err)
		}
		assertMigrationHistoryAnchor(t, absent.MigrationHistoryAnchor, f.migration)
	}
	for _, hash := range []string{strings.Repeat("0", 64), "0x" + strings.Repeat("0", 64)} {
		var absent MigrationHistoryTransactionView
		if err := json.Unmarshal(migrationHistoryRead(t, app, MigrationHistoryTransactionPath+hash), &absent); err != nil || absent.Found || absent.Transaction != nil {
			t.Fatal("unknown original transaction did not return explicit absence", hash, err)
		}
		assertMigrationHistoryAnchor(t, absent.MigrationHistoryAnchor, f.migration)
	}
	// The prior dedicated query stays byte-compatible for existing consumers.
	if !bytes.Equal(migrationHistoryRead(t, app, "/migration/transactions/"+f.history), mustJSON(t, originalTx)) || !bytes.Equal(originalMigration, mustJSON(t, app.migration)) || !bytes.Equal(originalState, mustJSON(t, app.committed)) {
		t.Fatal("source history query mutated state or changed the original query")
	}
}

func TestMigrationHistoryQueryRejectsRelabelingNoncanonicalPathsAndForeignState(t *testing.T) {
	f := newApplicationInitializationFixture(t)
	app, err := NewPersistentApplicationWithBootstrap(f.migration, "", f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	valid := MigrationHistoryBlockPath + "0"
	requests := []*abci.RequestQuery{{Path: valid, Prove: true}, {Path: valid, Data: []byte("not query authority")}, {Path: valid, Height: -1}, {Path: valid, Height: app.committed.Height + 1}}
	for _, suffix := range []string{"", "-1", "+1", "00", "01", " 1", "1/", "1?prove=true", "18446744073709551616"} {
		requests = append(requests, &abci.RequestQuery{Path: MigrationHistoryBlockPath + suffix})
	}
	for _, suffix := range []string{"", "abc", strings.Repeat("A", 64), "0X" + strings.Repeat("a", 64), f.history + "/", " " + f.history} {
		requests = append(requests, &abci.RequestQuery{Path: MigrationHistoryTransactionPath + suffix})
	}
	for _, req := range requests {
		response := &abci.ResponseQuery{Height: app.committed.Height, Value: []byte("must be cleared")}
		if !queryMigrationHistory(response, req, app.committed, app.migration) || response.Code == 0 || len(response.Value) != 0 {
			t.Fatal("source history accepted unsupported or relabeled query", req, response)
		}
	}
	for _, mode := range []string{"chain", "anchor", "height", "response-height", "missing-runtime"} {
		state, migration := app.committed, app.migration
		response := &abci.ResponseQuery{Height: state.Height, Value: []byte("must be cleared")}
		switch mode {
		case "chain":
			state.ChainID++
		case "anchor":
			state.MigrationStateHash = strings.Repeat("a", 64)
		case "height":
			state.Height = int64(migration.Height) - 1
			response.Height = state.Height
		case "response-height":
			response.Height++
		case "missing-runtime":
			migration.Runtime = nil
		}
		if !queryMigrationHistory(response, &abci.RequestQuery{Path: valid}, state, migration) || response.Code == 0 || len(response.Value) != 0 {
			t.Fatal("source history accepted foreign committed state", mode, response)
		}
	}
	response := &abci.ResponseQuery{Height: app.committed.Height, Value: []byte("untouched")}
	if queryMigrationHistory(response, &abci.RequestQuery{Path: "/migration"}, app.committed, app.migration) || string(response.Value) != "untouched" {
		t.Fatal("source history intercepted another original query")
	}
	response = &abci.ResponseQuery{Height: app.committed.Height}
	if !queryMigrationHistory(response, &abci.RequestQuery{Path: valid, Height: app.committed.Height}, app.committed, app.migration) || response.Code != 0 {
		t.Fatal("exact current ABCI query height was rejected")
	}
}

func TestMigrationHistoryQueryKeepsOriginalBytesAcrossAllColdLayouts(t *testing.T) {
	f := newApplicationInitializationFixture(t)
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			options := ApplicationInitializationOptions{StatePath: filepath.Join(t.TempDir(), "original-app", "state"), StateLayout: layout}
			if _, err := InitializeApplication(f.migration, f.raw, f.pins, options); err != nil {
				t.Fatal(err)
			}
			app, err := openInitializedApplication(f.migration, options, f.bootstrap)
			if err != nil {
				t.Fatal(err)
			}
			paths := []string{MigrationHistoryBlockPath + "0", MigrationHistoryBlockPath + strconv.FormatUint(f.migration.Height, 10), MigrationHistoryTransactionPath + f.history}
			originals := make(map[string][]byte)
			for _, path := range paths {
				originals[path] = migrationHistoryRead(t, app, path)
			}
			cold, err := openInitializedApplication(f.migration, options, f.bootstrap)
			if err != nil {
				t.Fatal(err)
			}
			for path, original := range originals {
				if !bytes.Equal(original, migrationHistoryRead(t, cold, path)) {
					t.Fatal("cold source history changed its original record or anchor", layout, path)
				}
			}
			if !bytes.Equal(mustJSON(t, app.committed), mustJSON(t, cold.committed)) || !bytes.Equal(mustJSON(t, f.migration), mustJSON(t, cold.migration)) {
				t.Fatal("read-only source history changed original accounts, contracts, policy or import")
			}
		})
	}
}

func TestMigrationHistoryQueryNeverReturnsPartialOrOversizedDTO(t *testing.T) {
	f := newApplicationInitializationFixture(t)
	state := initialCommittedState(f.migration)
	for _, mode := range []string{"marshal", "size"} {
		migration := f.migration
		runtime := *migration.Runtime
		runtime.Blocks = append([]chain.Block(nil), runtime.Blocks...)
		migration.Runtime = &runtime
		block := &runtime.Blocks[len(runtime.Blocks)-1]
		if mode == "marshal" {
			block.Time = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
		} else {
			block.Transactions = []chain.Transaction{{Memo: strings.Repeat("x", MaxMigrationHistoryQueryBytes)}}
		}
		response := &abci.ResponseQuery{Height: state.Height, Value: []byte("must be cleared")}
		if !queryMigrationHistory(response, &abci.RequestQuery{Path: MigrationHistoryBlockPath + strconv.FormatUint(block.Height, 10)}, state, migration) || response.Code == 0 || len(response.Value) != 0 {
			t.Fatal("encoding failure exposed a partial or oversized source response", mode, response.Code)
		}
	}
}
