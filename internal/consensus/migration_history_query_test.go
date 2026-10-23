package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"sort"
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

func TestMigrationHistoryPageOriginalOuterRowsOrderAndWindows(t *testing.T) {
	f := newApplicationInitializationFixture(t)
	app, err := NewPersistentApplicationWithBootstrap(f.migration, "", f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	originalMigration, originalState := mustJSON(t, app.migration), mustJSON(t, app.committed)
	want := make([]MigrationHistoryPageEntry, 0)
	nonemptyBlocks, newestCount, multipleInBlock := 0, uint64(0), false
	for _, block := range f.migration.Runtime.Blocks {
		if len(block.Transactions) > 0 {
			nonemptyBlocks++
			newestCount = uint64(len(block.Transactions))
			multipleInBlock = multipleInBlock || len(block.Transactions) > 1
		}
		for index, tx := range block.Transactions {
			want = append(want, MigrationHistoryPageEntry{Transaction: tx, NativeIndex: uint32(index)})
		}
	}
	if nonemptyBlocks < 2 || !multipleInBlock {
		t.Fatal("page fixture needs actual native transactions across blocks and within one block")
	}
	sort.SliceStable(want, func(i, j int) bool {
		return want[i].Transaction.BlockNum > want[j].Transaction.BlockNum || want[i].Transaction.BlockNum == want[j].Transaction.BlockNum && want[i].NativeIndex > want[j].NativeIndex
	})
	for _, window := range []struct {
		offset uint64
		limit  uint32
	}{{0, 100}, {0, 1}, {1, 2}, {newestCount - 1, 2}, {uint64(len(want)) - 1, 100}, {0, 0}, {uint64(len(want)) + 3, 3}, {math.MaxUint64, 0}} {
		path := MigrationHistoryPagePath + strconv.FormatUint(window.offset, 10) + "/" + strconv.FormatUint(uint64(window.limit), 10)
		raw := migrationHistoryRead(t, app, path)
		var view MigrationHistoryPageView
		if err := json.Unmarshal(raw, &view); err != nil || view.Offset != window.offset || view.Limit != window.limit || view.Total != uint64(len(want)) || view.Records == nil {
			t.Fatal("source page lost exact coordinates, complete outer-row total or empty array", path, err)
		}
		assertMigrationHistoryAnchor(t, view.MigrationHistoryAnchor, f.migration)
		start := window.offset
		if start > uint64(len(want)) {
			start = uint64(len(want))
		}
		end := start + uint64(window.limit)
		if end > uint64(len(want)) {
			end = uint64(len(want))
		}
		if !reflect.DeepEqual(view.Records, want[start:end]) {
			t.Fatal("source page changed a native transaction, its original index or newest-first order", path)
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil || string(fields["offset"]) != strconv.Quote(strconv.FormatUint(window.offset, 10)) || string(fields["limit"]) != strconv.Quote(strconv.FormatUint(uint64(window.limit), 10)) || string(fields["total"]) != strconv.Quote(strconv.Itoa(len(want))) {
			t.Fatal("page coordinates are not canonical JSON strings", err)
		}
		for _, entry := range view.Records {
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(mustJSON(t, entry), &fields); err != nil || string(fields["nativeIndex"]) != strconv.Quote(strconv.FormatUint(uint64(entry.NativeIndex), 10)) {
				t.Fatal("page native index lost its canonical original coordinate", err)
			}
		}
	}
	if !bytes.Equal(originalMigration, mustJSON(t, app.migration)) || !bytes.Equal(originalState, mustJSON(t, app.committed)) {
		t.Fatal("source pagination mutated imported history or committed state")
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
	for _, suffix := range []string{"", "0", "0/", "/1", "0/1/", "0/1/2", "00/1", "0/01", "+1/1", "-1/1", " 1/1", "0/101", "0/4294967296", "18446744073709551616/0", "18446744073709551615/1"} {
		requests = append(requests, &abci.RequestQuery{Path: MigrationHistoryPagePath + suffix})
	}
	for _, suffix := range []string{"", "0", "0/", "/0", "0/0/", "0/0/0", "00/0", "0/00", "+0/0", "-1/0", " 0/0", "1/0", "0/1000", "0/18446744073709551616", "0/0?prove=true", "0/" + strconv.FormatUint(f.migration.Height+1, 10)} {
		requests = append(requests, &abci.RequestQuery{Path: MigrationHistoryLogsPath + suffix})
	}
	requests = append(requests, &abci.RequestQuery{Path: MigrationHistoryPagePath + "0/1", Prove: true}, &abci.RequestQuery{Path: MigrationHistoryPagePath + "0/1", Data: []byte("not query authority")}, &abci.RequestQuery{Path: MigrationHistoryPagePath + "0/1", Height: app.committed.Height + 1})
	requests = append(requests, &abci.RequestQuery{Path: MigrationHistoryLogsPath + "0/0", Prove: true}, &abci.RequestQuery{Path: MigrationHistoryLogsPath + "0/0", Data: []byte("not query authority")}, &abci.RequestQuery{Path: MigrationHistoryLogsPath + "0/0", Height: -1}, &abci.RequestQuery{Path: MigrationHistoryLogsPath + "0/0", Height: app.committed.Height + 1})
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
		for _, path := range []string{valid, MigrationHistoryPagePath + "0/1", MigrationHistoryLogsPath + "0/0"} {
			response.Code, response.Log, response.Value = 0, "", []byte("must be cleared")
			if !queryMigrationHistory(response, &abci.RequestQuery{Path: path}, state, migration) || response.Code == 0 || len(response.Value) != 0 {
				t.Fatal("source history accepted foreign committed state", mode, path, response)
			}
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

func TestMigrationHistoryLogsPreserveExecutedContractEventsAndColdBytes(t *testing.T) {
	migration, contract, _ := sourceCounterMigration(t, false)
	path := filepath.Join(t.TempDir(), "state.json")
	app, err := NewPersistentApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	originalFile, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	originalMigration, originalState := mustJSON(t, migration), mustJSON(t, app.committed)
	executedEvents := false
	for _, block := range migration.Runtime.Blocks {
		for _, tx := range block.Transactions {
			if tx.Type == "contract_call" && tx.To == contract.Address && len(tx.Logs) > 1 {
				executedEvents = true
			}
		}
	}
	if !executedEvents || len(app.committed.EVMReceipts) != 0 || len(app.committed.EVMLogs) != 0 {
		t.Fatal("fixture must retain actual old contract events without replaying them as new BFT execution")
	}
	originals := make(map[string][]byte)
	for _, window := range [][2]uint64{{0, 0}, {0, migration.Height}, {1, migration.Height}, {migration.Height, migration.Height}} {
		queryPath := MigrationHistoryLogsPath + strconv.FormatUint(window[0], 10) + "/" + strconv.FormatUint(window[1], 10)
		raw := migrationHistoryRead(t, app, queryPath)
		var view MigrationHistoryLogsView
		if err := json.Unmarshal(raw, &view); err != nil || view.From != window[0] || view.To != window[1] || view.Logs == nil {
			t.Fatal("source logs lost exact inclusive bounds or a nonnil empty array", queryPath, err)
		}
		assertMigrationHistoryAnchor(t, view.MigrationHistoryAnchor, migration)
		want := make([]chain.EVMLog, 0)
		for _, block := range migration.Runtime.Blocks {
			if block.Height >= window[0] && block.Height <= window[1] {
				for _, tx := range block.Transactions {
					want = append(want, tx.Logs...)
				}
			}
		}
		if !reflect.DeepEqual(view.Logs, want) {
			t.Fatal("source query regenerated or reordered persisted contract event bytes and coordinates", queryPath)
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil || string(fields["from"]) != strconv.Quote(strconv.FormatUint(window[0], 10)) || string(fields["to"]) != strconv.Quote(strconv.FormatUint(window[1], 10)) {
			t.Fatal("source log bounds are not canonical JSON strings", err)
		}
		if window[0] == 0 && window[1] == 0 && string(fields["logs"]) != "[]" {
			t.Fatal("empty original genesis log range must remain an empty JSON array")
		}
		originals[queryPath] = raw
	}
	exactHeight, err := app.Query(context.Background(), &abci.RequestQuery{Path: MigrationHistoryLogsPath + "0/" + strconv.FormatUint(migration.Height, 10), Height: app.committed.Height})
	if err != nil || exactHeight.Code != 0 || !bytes.Equal(exactHeight.Value, originals[MigrationHistoryLogsPath+"0/"+strconv.FormatUint(migration.Height, 10)]) {
		t.Fatal("exact committed query height changed original source logs", err)
	}
	cold, err := NewPersistentApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	for queryPath, original := range originals {
		if !bytes.Equal(original, migrationHistoryRead(t, cold, queryPath)) {
			t.Fatal("cold source log query changed original events or import anchor bytes", queryPath)
		}
	}
	afterFile, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(originalFile, afterFile) || !bytes.Equal(originalMigration, mustJSON(t, migration)) || !bytes.Equal(originalMigration, mustJSON(t, cold.migration)) || !bytes.Equal(originalState, mustJSON(t, app.committed)) || !bytes.Equal(originalState, mustJSON(t, cold.committed)) {
		t.Fatal("read-only source logs or cold recovery changed original state, import or persistent bytes", err)
	}
}

func TestMigrationHistoryLogsInclusiveRangeBoundary(t *testing.T) {
	for _, tc := range []struct {
		raw    string
		height uint64
		from   uint64
		to     uint64
		valid  bool
	}{
		{"0/0", 1, 0, 0, true},
		{"0/999", 999, 0, 999, true},
		{"1/1000", 1000, 1, 1000, true},
		{"18446744073709550616/18446744073709551615", math.MaxUint64, math.MaxUint64 - 999, math.MaxUint64, true},
		{"0/1000", 1000, 0, 0, false},
		{"1/1001", 1001, 0, 0, false},
		{"0/999", 998, 0, 0, false},
		{"18446744073709551615/0", math.MaxUint64, 0, 0, false},
		{"0/18446744073709551616", math.MaxUint64, 0, 0, false},
	} {
		from, to, err := migrationHistoryLogsRange(tc.raw, tc.height)
		if (err == nil) != tc.valid || tc.valid && (from != tc.from || to != tc.to) {
			t.Fatal("source inclusive log range boundary changed", tc.raw, from, to, err)
		}
	}
}

func TestMigrationHistoryLogsRejectAlteredCoordinatesAndOversizedResponse(t *testing.T) {
	original, _, _ := sourceCounterMigration(t, false)
	state := initialCommittedState(original)
	originalBytes := mustJSON(t, original)
	blockIndex, transactionIndex := -1, -1
	for i, block := range original.Runtime.Blocks {
		for j, tx := range block.Transactions {
			if tx.Type == "contract_call" && len(tx.Logs) > 1 {
				blockIndex, transactionIndex = i, j
			}
		}
	}
	if blockIndex < 0 {
		t.Fatal("fixture requires actual ordered contract execution events")
	}
	for _, tc := range []struct {
		name   string
		mutate func(*chain.Block, *chain.Transaction)
	}{
		{"block-height", func(block *chain.Block, _ *chain.Transaction) { block.Height++ }},
		{"transaction-height", func(_ *chain.Block, tx *chain.Transaction) { tx.BlockNum++ }},
		{"transaction-block", func(_ *chain.Block, tx *chain.Transaction) { tx.BlockHash = strings.Repeat("a", 64) }},
		{"log-height", func(_ *chain.Block, tx *chain.Transaction) { tx.Logs[0].BlockNumber++ }},
		{"log-block", func(block *chain.Block, tx *chain.Transaction) { tx.Logs[0].BlockHash = block.Hash }},
		{"log-transaction", func(_ *chain.Block, tx *chain.Transaction) { tx.Logs[0].TransactionHash = strings.Repeat("a", 64) }},
		{"transaction-index", func(_ *chain.Block, tx *chain.Transaction) { tx.Logs[0].TransactionIndex++ }},
		{"global-log-index", func(_ *chain.Block, tx *chain.Transaction) { tx.Logs[0].LogIndex++ }},
		{"removed", func(_ *chain.Block, tx *chain.Transaction) { tx.Logs[0].Removed = true }},
		{"order", func(_ *chain.Block, tx *chain.Transaction) { tx.Logs[0], tx.Logs[1] = tx.Logs[1], tx.Logs[0] }},
		{"size", func(_ *chain.Block, tx *chain.Transaction) {
			tx.Logs[0].Data = strings.Repeat("a", MaxMigrationHistoryQueryBytes)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var migration chain.ConsensusMigrationState
			if err := json.Unmarshal(originalBytes, &migration); err != nil {
				t.Fatal(err)
			}
			block := &migration.Runtime.Blocks[blockIndex]
			tc.mutate(block, &block.Transactions[transactionIndex])
			response := &abci.ResponseQuery{Height: state.Height, Value: []byte("must be cleared")}
			queryPath := MigrationHistoryLogsPath + "0/" + strconv.FormatUint(original.Height, 10)
			if !queryMigrationHistory(response, &abci.RequestQuery{Path: queryPath}, state, migration) || response.Code == 0 || len(response.Value) != 0 {
				t.Fatal("altered or oversized original logs exposed a partial success", tc.name, response.Code, response.Log)
			}
		})
	}
	if !bytes.Equal(originalBytes, mustJSON(t, original)) {
		t.Fatal("source log validation changed the original import")
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
			paths := []string{MigrationHistoryBlockPath + "0", MigrationHistoryBlockPath + strconv.FormatUint(f.migration.Height, 10), MigrationHistoryTransactionPath + f.history, MigrationHistoryPagePath + "0/2", MigrationHistoryPagePath + "0/0", MigrationHistoryLogsPath + "0/" + strconv.FormatUint(f.migration.Height, 10), MigrationHistoryLogsPath + "0/0"}
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
			block.Transactions = append([]chain.Transaction(nil), block.Transactions...)
			if len(block.Transactions) == 0 {
				t.Fatal("fixture requires actual source transactions in the latest block")
			}
			block.Transactions[0].Timestamp = block.Time
		} else {
			block.Transactions = []chain.Transaction{{Memo: strings.Repeat("x", MaxMigrationHistoryQueryBytes)}}
		}
		for _, path := range []string{MigrationHistoryBlockPath + strconv.FormatUint(block.Height, 10), MigrationHistoryPagePath + "0/100"} {
			response := &abci.ResponseQuery{Height: state.Height, Value: []byte("must be cleared")}
			if !queryMigrationHistory(response, &abci.RequestQuery{Path: path}, state, migration) || response.Code == 0 || len(response.Value) != 0 {
				t.Fatal("encoding failure exposed a partial or oversized source response", mode, path, response.Code)
			}
		}
		// A metadata read never serializes unrequested transaction bodies.
		response := &abci.ResponseQuery{Height: state.Height}
		if !queryMigrationHistory(response, &abci.RequestQuery{Path: MigrationHistoryPagePath + "0/0"}, state, migration) || response.Code != 0 {
			t.Fatal("metadata-only source pagination encoded an unrequested body", mode, response.Log)
		}
		var metadata MigrationHistoryPageView
		if err := json.Unmarshal(response.Value, &metadata); err != nil || metadata.Records == nil || len(metadata.Records) != 0 || metadata.Total == 0 {
			t.Fatal("metadata-only source pagination lost its outer-row count or empty array", err)
		}
	}
}
