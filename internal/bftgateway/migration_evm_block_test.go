package bftgateway

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
	abci "github.com/cometbft/cometbft/abci/types"
)

type importedEVMBlockFixture struct {
	f          *pqIdentityFixture
	gateway    *Gateway
	block      chain.Block
	ethereum   ethnative.Transfer
	mode       atomic.Value
	cometReads atomic.Int64
	newHash    string
}

// The source records below come from an actual native Runtime import and
// Application.Query. The substituted Comet transport is not a finality test.
func newImportedEVMBlockFixture(t *testing.T) *importedEVMBlockFixture {
	t.Helper()
	raw, ethereum := migrationEthereumVector(t, "valid")
	f := newPQIdentityFixture(t, func(d *chain.Devnet) {
		if _, err := d.Faucet(ethereum.From, 100); err != nil {
			t.Fatal(err)
		}
		d.ProduceBlock()
		if err := d.SetEthereumNativeTransfers(true); err != nil {
			t.Fatal(err)
		}
		if _, replay, err := d.SubmitSignedTransfer(chain.SignedTransferInput{Hash: ethereum.Hash, From: ethereum.From, To: ethereum.To, Amount: ethereum.Amount, Fee: 1, Nonce: ethereum.Nonce + 1, EthereumRaw: raw}); err != nil || replay {
			t.Fatalf("original Ethereum admission: replay=%v err=%v", replay, err)
		}
		if _, err := d.Transfer(ethereum.From, "0x"+strings.Repeat("2", 40), 3); err != nil {
			t.Fatal(err)
		}
		d.ProduceBlock()
	})
	tx := &importedEVMBlockFixture{f: f, ethereum: ethereum, newHash: strings.Repeat("d", 64)}
	tx.mode.Store("")
	for _, block := range f.migration.Runtime.Blocks {
		for _, row := range block.Transactions {
			if row.Hash == ethereum.Hash {
				tx.block = block
			}
		}
	}
	if tx.block.Height == 0 || len(tx.block.Transactions) != 2 || tx.block.Transactions[0].Hash != ethereum.Hash {
		t.Fatal("fixture requires two original transactions in one retained source block")
	}
	base := f.serve(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Error("readonly source block lookup attempted a mutation", r.Method)
			w.WriteHeader(405)
			return
		}
		if r.URL.Path == "/abci_query" {
			path, _ := strconv.Unquote(r.URL.Query().Get("path"))
			if !strings.HasPrefix(path, consensus.MigrationHistoryBlockPath) && !strings.HasPrefix(path, consensus.MigrationHistoryBlockHashPath) {
				base.ServeHTTP(w, r)
				return
			}
			mode := tx.mode.Load().(string)
			if mode == "http" {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			response, err := f.app.Query(r.Context(), &abci.RequestQuery{Path: path})
			if err != nil || response.Code != 0 {
				t.Error("actual source block query failed", err, response)
				w.WriteHeader(500)
				return
			}
			var view consensus.MigrationHistoryBlockView
			if err := json.Unmarshal(response.Value, &view); err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			mutateMigrationAnchor(&view.MigrationHistoryAnchor, mode)
			if view.Block != nil {
				switch mode {
				case "record-height":
					view.Block.Height++
				case "record-hash":
					view.Block.Hash = strings.Repeat("e", 64)
				case "record-parent":
					view.Block.ParentHash = "invalid"
				case "record-transaction":
					view.Block.Transactions[0].BlockHash = strings.Repeat("e", 64)
				case "membership":
					view.Found = false
				case "missing-record":
					view.Found, view.Block = false, nil
				case "ethereum-memo":
					view.Block.Transactions[0].Memo = ethnative.MemoPrefix + "00"
				}
			}
			response.Value, err = json.Marshal(view)
			if err != nil {
				t.Error(err)
			}
			if mode == "duplicate" {
				response.Value = bytes.Replace(response.Value, []byte(`"found":true`), []byte(`"found":false,"found":true`), 1)
			}
			if mode == "query-height" {
				response.Height++
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{"code": response.Code, "height": strconv.FormatInt(response.Height, 10), "value": base64.StdEncoding.EncodeToString(response.Value)}}})
			return
		}
		tx.cometReads.Add(1)
		height := strconv.FormatUint(f.migration.Height+1, 10)
		switch r.URL.Path {
		case "/block_by_hash":
			if r.URL.Query().Get("hash") != "0x"+tx.newHash {
				_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": -32603, "message": "block not found"}})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"block_id": map[string]any{"hash": tx.newHash},
				"block": map[string]any{
					"header": map[string]any{"height": height, "time": time.Date(2026, 10, 18, 1, 2, 3, 0, time.UTC), "proposer_address": strings.Repeat("c", 40), "app_hash": strings.Repeat("b", 64)},
					"data":   map[string]any{"txs": []string{}},
				},
			}})
		case "/block_results":
			if r.URL.Query().Get("height") != height {
				t.Error("new Comet result read at wrong height")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"height": height, "txs_results": []any{}}})
		default:
			t.Error("unexpected Comet source block fallback", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	t.Cleanup(upstream.Close)
	var err error
	tx.gateway, err = New(Config{CometRPCURL: upstream.URL, MigrationHeight: f.migration.Height, MigrationBlockHash: f.migration.LastBlockHash})
	if err != nil {
		t.Fatal(err)
	}
	return tx
}

func (f *importedEVMBlockFixture) rpc(t *testing.T, method string, params ...any) (json.RawMessage, bool) {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	f.gateway.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/evm", bytes.NewReader(raw)))
	var response struct {
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil {
		t.Fatal("EVM block RPC response malformed", w.Code, w.Body.String())
	}
	return response.Result, len(response.Error) > 0 && string(response.Error) != "null"
}

func TestGatewayImportedEVMBlocksActualSourceAndColdRead(t *testing.T) {
	f := newImportedEVMBlockFixture(t)
	stateBefore, err := os.ReadFile(f.f.statePath)
	if err != nil {
		t.Fatal(err)
	}
	migrationBefore, err := f.f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	number, hash := hexEVMQuantity(f.block.Height), "0x"+f.block.Hash
	readBlock := func(identifier string, byHash, full bool) json.RawMessage {
		t.Helper()
		method := "eth_getBlockByNumber"
		if byHash {
			method = "eth_getBlockByHash"
		}
		raw, failed := f.rpc(t, method, identifier, full)
		if failed || string(raw) == "null" {
			t.Fatal("actual original block was not readable", method, identifier, string(raw))
		}
		return raw
	}
	compact := readBlock(number, false, false)
	var block map[string]json.RawMessage
	if err := json.Unmarshal(compact, &block); err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]string{"number": number, "hash": hash, "parentHash": "0x" + f.block.ParentHash, "timestamp": hexEVMQuantity(uint64(f.block.Time.Unix()))} {
		if string(block[key]) != strconv.Quote(want) {
			t.Fatal("original block field changed", key, string(block[key]), want)
		}
	}
	if string(block["independentFinality"]) != "false" {
		t.Fatal("imported original acquired independent finality")
	}
	var original chain.Block
	var anchor consensus.MigrationHistoryAnchor
	if json.Unmarshal(block["ynxSourceBlock"], &original) != nil || !reflect.DeepEqual(original, f.block) || json.Unmarshal(block["ynxSourceHistory"], &anchor) != nil || anchor.Source != "source_import" || anchor.SourceAnchor != f.f.migration.StateHash || anchor.OriginalGenesisHash != f.f.migration.OriginalGenesisHash {
		t.Fatal("original source fields or pinned source identity were lost")
	}
	var unavailable, hashes []string
	if json.Unmarshal(block["ynxUnavailableFields"], &unavailable) != nil || json.Unmarshal(block["transactions"], &hashes) != nil || len(hashes) != len(f.block.Transactions) {
		t.Fatal("original hash list or unavailable field list malformed")
	}
	for _, field := range []string{"stateRoot", "receiptsRoot", "transactionsRoot", "gasUsed", "gasLimit", "miner", "baseFeePerGas", "logsBloom"} {
		if string(block[field]) != "null" || !slices.Contains(unavailable, field) {
			t.Fatal("missing Ethereum execution evidence was fabricated", field)
		}
	}
	for index, tx := range f.block.Transactions {
		if hashes[index] != "0x"+strings.TrimPrefix(tx.Hash, "0x") {
			t.Fatal("original transaction hash bytes changed")
		}
	}
	full := readBlock(number, false, true)
	var fullBlock struct {
		Transactions []map[string]json.RawMessage `json:"transactions"`
	}
	if json.Unmarshal(full, &fullBlock) != nil || len(fullBlock.Transactions) != 2 {
		t.Fatal("full original block did not retain both source rows")
	}
	for index, fields := range fullBlock.Transactions {
		var native chain.Transaction
		if json.Unmarshal(fields["ynxNativeTransaction"], &native) != nil || !reflect.DeepEqual(native, f.block.Transactions[index]) || string(fields["transactionIndex"]) != strconv.Quote(hexEVMQuantity(uint64(index))) || string(fields["independentFinality"]) != "false" {
			t.Fatal("full original transaction fields, source position or provenance changed")
		}
	}
	eth := fullBlock.Transactions[0]
	for key, want := range map[string]string{"ynxEncoding": "ethereum-legacy-source", "hash": f.ethereum.Hash, "value": ethnative.Quantity(f.ethereum.Value), "nonce": hexEVMQuantity(f.ethereum.Nonce), "gas": hexEVMQuantity(f.ethereum.Gas), "gasPrice": ethnative.Quantity(f.ethereum.GasPrice), "v": ethnative.Quantity(f.ethereum.V), "r": fmt.Sprintf("0x%064x", f.ethereum.R), "s": fmt.Sprintf("0x%064x", f.ethereum.S)} {
		if string(eth[key]) != strconv.Quote(want) {
			t.Fatal("signed original Ethereum field changed", key, string(eth[key]), want)
		}
	}
	native := fullBlock.Transactions[1]
	if string(native["ynxEncoding"]) != `"native-source"` {
		t.Fatal("ordinary native transaction mislabeled as Ethereum")
	}
	for _, field := range []string{"value", "nonce", "gas", "gasPrice", "v", "r", "s", "type", "input"} {
		if string(native[field]) != "null" {
			t.Fatal("ordinary native transaction acquired a fabricated Ethereum field", field)
		}
	}
	if !bytes.Equal(full, readBlock(hash, true, true)) {
		t.Fatal("source block hash and native height returned different original records")
	}
	if count, failed := f.rpc(t, "eth_getBlockTransactionCountByNumber", number); failed || string(count) != `"0x2"` {
		t.Fatal("old source transaction count changed", string(count))
	}
	if count, failed := f.rpc(t, "eth_getBlockTransactionCountByHash", hash); failed || string(count) != `"0x2"` {
		t.Fatal("old source hash transaction count changed", string(count))
	}
	first, err := json.Marshal(fullBlock.Transactions[0])
	if err != nil {
		t.Fatal(err)
	}
	if row, failed := f.rpc(t, "eth_getTransactionByBlockHashAndIndex", hash, "0x0"); failed || !bytes.Equal(row, first) {
		t.Fatal("source indexed transaction differs from full block")
	}
	if row, failed := f.rpc(t, "eth_getTransactionByBlockNumberAndIndex", number, "0x2"); failed || string(row) != "null" {
		t.Fatal("source out-of-range transaction index did not return null")
	}
	var genesis map[string]json.RawMessage
	if json.Unmarshal(readBlock("earliest", false, false), &genesis) != nil || string(genesis["number"]) != `"0x0"` || string(genesis["parentHash"]) != "null" {
		t.Fatal("earliest did not preserve original native genesis and missing parent")
	}
	if f.cometReads.Load() != 0 {
		t.Fatal("old source blocks were read from the Comet namespace")
	}
	cold, err := consensus.NewPersistentApplicationWithBootstrap(f.f.migration, f.f.statePath, f.f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	f.f.app = cold
	if !bytes.Equal(full, readBlock(hash, true, true)) {
		t.Fatal("cold recovery changed original EVM block fields or anchor")
	}
	stateAfter, err := os.ReadFile(f.f.statePath)
	if err != nil {
		t.Fatal(err)
	}
	migrationAfter, err := f.f.migration.CanonicalJSON()
	if err != nil || !bytes.Equal(stateBefore, stateAfter) || !bytes.Equal(migrationBefore, migrationAfter) {
		t.Fatal("readonly block lookup or cold recovery rewrote source state", err)
	}
	var newBlock map[string]json.RawMessage
	if json.Unmarshal(readBlock("0x"+f.newHash, true, false), &newBlock) != nil || string(newBlock["stateRoot"]) != strconv.Quote("0x"+strings.Repeat("b", 64)) || len(newBlock["ynxSourceHistory"]) != 0 || f.cometReads.Load() != 2 {
		t.Fatal("explicit source nonmembership did not retain the real Comet block path")
	}
	for _, tag := range []string{"latest", "safe", "finalized", "pending"} {
		_, selected, _, err := f.gateway.importedEVMBlock(context.Background(), false, json.RawMessage(strconv.Quote(tag)))
		if err != nil || selected {
			t.Fatal("new-only tag acquired imported history semantics", tag, err)
		}
	}
}

func TestGatewayImportedEVMBlockBadSourceNeverFallsBack(t *testing.T) {
	f := newImportedEVMBlockFixture(t)
	for _, mode := range []string{"http", "anchor", "genesis", "migration", "chain", "height", "query-height", "record-height", "record-hash", "record-parent", "record-transaction", "membership", "duplicate", "ethereum-memo"} {
		f.mode.Store(mode)
		for _, lookup := range []struct{ method, identifier string }{{"eth_getBlockByNumber", hexEVMQuantity(f.block.Height)}, {"eth_getBlockByHash", "0x" + f.block.Hash}} {
			if _, failed := f.rpc(t, lookup.method, lookup.identifier, true); !failed {
				t.Fatal("invalid source block was accepted", mode, lookup.method)
			}
		}
		if mode != "ethereum-memo" {
			if _, failed := f.rpc(t, "eth_getBlockTransactionCountByHash", "0x"+f.block.Hash); !failed {
				t.Fatal("invalid source block was accepted by its count route", mode)
			}
		}
		if _, failed := f.rpc(t, "eth_getTransactionByBlockNumberAndIndex", hexEVMQuantity(f.block.Height), "0x0"); !failed {
			t.Fatal("invalid source block was accepted by its indexed route", mode)
		}
	}
	f.mode.Store("missing-record")
	for _, number := range []string{hexEVMQuantity(f.block.Height), "earliest"} {
		view, selected, code, err := f.gateway.importedEVMBlock(context.Background(), false, json.RawMessage(strconv.Quote(number)))
		if err == nil || !selected || code != -32603 || view != nil {
			t.Fatal("missing known source height did not fail as incomplete source", number, code, err)
		}
		if _, failed := f.rpc(t, "eth_getBlockByNumber", number, false); !failed {
			t.Fatal("known original height disappeared behind a successful null result", number)
		}
		if _, failed := f.rpc(t, "eth_getBlockTransactionCountByNumber", number); !failed {
			t.Fatal("known original height disappeared behind a successful null count", number)
		}
		if _, failed := f.rpc(t, "eth_getTransactionByBlockNumberAndIndex", number, "0x0"); !failed {
			t.Fatal("known original height disappeared behind a successful null indexed result", number)
		}
	}
	if f.cometReads.Load() != 0 {
		t.Fatal("failed source observations fell back to new Comet records")
	}
}
