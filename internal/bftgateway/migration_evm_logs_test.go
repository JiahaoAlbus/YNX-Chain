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
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestGatewayOriginalEVMLogsCrossMigrationAndColdRead(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 71))
	owner, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	source, _ := gatewayBoundedFixture(t)
	var address string
	f := newPQIdentityFixture(t, func(d *chain.Devnet) {
		if _, err := d.Faucet(owner, 1000); err != nil {
			t.Fatal(err)
		}
		d.ProduceBlock()
		contract, _, err := d.DeployContractWithArgs(owner, "SampleEVMWriteCounter", source, []string{"7"})
		if err != nil {
			t.Fatal(err)
		}
		address = contract.Address
		for _, amount := range []string{"5", "3"} {
			if _, _, err := d.ExecuteContract(owner, address, "0x7cf5dab0"+strings.Repeat("0", 63)+amount); err != nil {
				t.Fatal(err)
			}
		}
		d.ProduceBlock()
	})
	want := make([]chain.EVMLog, 0)
	var event chain.EVMLog
	for _, block := range f.migration.Runtime.Blocks {
		for _, tx := range block.Transactions {
			want = append(want, tx.Logs...)
			if tx.Type == "contract_call" && len(tx.Logs) > 1 {
				// The first source log is native provenance; the final log is
				// the actual compiled Counter execution event.
				event = tx.Logs[len(tx.Logs)-1]
			}
		}
	}
	if event.Address != address || len(event.Topics) == 0 || event.TransactionIndex == 0 || event.LogIndex == 0 {
		t.Fatal("fixture requires real executed contract events and nonzero original indexes")
	}
	// The postmigration event is produced by the real signed IDE action and
	// Application executor. The existing Comet fixture supplies only transport.
	call := consensus.IDEContractCallPayload{Address: address, Calldata: "0x7cf5dab0" + strings.Repeat("0", 63) + "2", IdempotencyKey: "original-logs-next-call"}
	call.RequestHash = consensus.IDECallRequestHash(call.Address, call.Calldata, call.IdempotencyKey)
	raw := signedIDEFixture(t, key, consensus.ActionIDEContractCall, call, f.migration.Runtime.Accounts[owner].Nonce+1)
	check, err := f.app.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: raw})
	if err != nil || check.Code != 0 {
		t.Fatal("real postmigration IDE action failed CheckTx", check, err)
	}
	height, at := f.stateHeight+1, f.commit.Header.Time.Add(time.Second)
	final, err := f.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Time: at, NextValidatorsHash: f.set.Hash(), Txs: [][]byte{raw}})
	if err != nil || len(final.TxResults) != 1 || final.TxResults[0].Code != 0 {
		t.Fatal("real postmigration IDE event failed execution", final, err)
	}
	if _, err := f.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	live := newABCICometFixture(t, f.app, height)
	live.blocks[height], live.times[height] = raw, at
	stateBefore, err := os.ReadFile(f.statePath)
	if err != nil {
		t.Fatal(err)
	}
	migrationBefore, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	var mode atomic.Value
	mode.Store("")
	var oldReads, newReads atomic.Int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if mode.Load().(string) == "pruned" && r.URL.Path == "/status" {
			writeJSON(w, 200, map[string]any{"result": map[string]any{
				"node_info": map[string]any{"network": "ynx_6423-1"},
				"sync_info": map[string]any{"earliest_block_height": strconv.FormatInt(height, 10), "latest_block_height": strconv.FormatInt(height, 10), "earliest_block_hash": strings.Repeat("A", 64), "latest_block_hash": strings.Repeat("A", 64), "earliest_block_time": at, "latest_block_time": at, "catching_up": false},
			}})
			return
		}
		path, _ := strconv.Unquote(r.URL.Query().Get("path"))
		if r.URL.Path == "/abci_query" && path == "/evm/logs" {
			newReads.Add(1)
		}
		if r.URL.Path != "/abci_query" || !strings.HasPrefix(path, consensus.MigrationHistoryLogsPath) {
			if mode.Load().(string) == "block-http" && strings.HasPrefix(path, consensus.MigrationHistoryBlockPath) {
				w.WriteHeader(503)
				return
			}
			live.ServeHTTP(w, r)
			return
		}
		oldReads.Add(1)
		current := mode.Load().(string)
		if current == "source-http" {
			w.WriteHeader(503)
			return
		}
		response, err := f.app.Query(r.Context(), &abci.RequestQuery{Path: path})
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		var view consensus.MigrationHistoryLogsView
		if err := json.Unmarshal(response.Value, &view); err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		switch current {
		case "range":
			view.From++
		case "nil":
			view.Logs = nil
		case "anchor":
			view.SourceAnchor = strings.Repeat("a", 64)
		}
		if len(view.Logs) > 0 {
			switch current {
			case "block-hash":
				view.Logs[0].BlockHash = "0x" + strings.Repeat("b", 64)
			case "tx-index":
				view.Logs[0].TransactionIndex++
			case "log-index":
				view.Logs[0].LogIndex++
			case "body":
				view.Logs[0].Data = "0x01"
			case "partial-block":
				view.Logs = view.Logs[:len(view.Logs)-1]
			case "order":
				view.Logs[0], view.Logs[len(view.Logs)-1] = view.Logs[len(view.Logs)-1], view.Logs[0]
			case "duplicate":
				view.Logs = append(view.Logs, view.Logs[0])
			}
		}
		response.Value, err = json.Marshal(view)
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		writeJSON(w, 200, map[string]any{"result": map[string]any{"response": map[string]any{"code": response.Code, "height": strconv.FormatInt(response.Height, 10), "value": base64.StdEncoding.EncodeToString(response.Value)}}})
	}))
	defer upstream.Close()
	g, err := New(Config{CometRPCURL: upstream.URL, MigrationHeight: f.migration.Height, MigrationBlockHash: f.migration.LastBlockHash})
	if err != nil {
		t.Fatal(err)
	}
	read := func(filter string) ([]byte, []map[string]any, string) {
		t.Helper()
		w := httptest.NewRecorder()
		g.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/evm", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[`+filter+`]}`)))
		var response struct {
			Result []map[string]any `json:"result"`
			Error  *struct {
				Code    int    `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil {
			t.Fatal("invalid EVM log response", w.Code, w.Body.String())
		}
		if response.Error != nil {
			if response.Error.Code != -32602 || response.Result != nil {
				t.Fatal("source logs returned partial data or changed the RPC error contract", w.Body.String())
			}
			return bytes.Clone(w.Body.Bytes()), nil, response.Error.Message
		}
		return bytes.Clone(w.Body.Bytes()), response.Result, ""
	}
	sourceFilter := fmt.Sprintf(`{"fromBlock":"earliest","toBlock":%q}`, hexEVMQuantity(f.migration.Height))
	_, originals, failure := read(sourceFilter)
	if failure != "" || len(originals) != len(want) || newReads.Load() != 0 {
		t.Fatal("source-only logs were lost or queried as new events", failure, len(originals), len(want), newReads.Load())
	}
	for i, original := range want {
		row := originals[i]
		topics, topicsErr := json.Marshal(row["topics"])
		originalTopics, originalTopicsErr := json.Marshal(original.Topics)
		if row["blockHash"] != original.BlockHash || row["blockNumber"] != hexEVMQuantity(original.BlockNumber) || row["transactionHash"] != original.TransactionHash || row["transactionIndex"] != hexEVMQuantity(original.TransactionIndex) || row["logIndex"] != hexEVMQuantity(original.LogIndex) || row["address"] != original.Address || row["data"] != original.Data || row["removed"] != original.Removed || row["independentFinality"] != false {
			t.Fatal("source event fields or coordinates were regenerated", i, row, original)
		}
		if topicsErr != nil || originalTopicsErr != nil || !bytes.Equal(topics, originalTopics) {
			t.Fatal("source event topics were regenerated", i)
		}
		anchor, ok := row["ynxSourceHistory"].(map[string]any)
		if !ok || anchor["source"] != "source_import" || anchor["sourceAnchor"] != f.migration.StateHash {
			t.Fatal("source event lost its original provenance")
		}
	}
	if _, empty, failure := read(`{"fromBlock":"0x0","toBlock":"0x0"}`); failure != "" || empty == nil || len(empty) != 0 || newReads.Load() != 0 {
		t.Fatal("empty source log window is unavailable, null or forwarded", failure)
	}
	if _, err := g.evmCommittedAccountResult(context.Background(), "eth_getBalance", json.RawMessage(fmt.Sprintf(`[%q,"0x0"]`, owner))); err == nil {
		t.Fatal("source log support weakened historical account state rejection")
	}
	if _, err := g.requireCurrentCommittedTag(context.Background(), json.RawMessage(`"0x0"`)); err == nil {
		t.Fatal("source log support weakened historical contract state rejection")
	}
	oldReads.Store(0)
	_, onlyNew, failure := read(fmt.Sprintf(`{"fromBlock":%q,"toBlock":%q}`, hexEVMQuantity(uint64(height)), hexEVMQuantity(uint64(height))))
	if failure != "" || len(onlyNew) != 1 || oldReads.Load() != 0 || onlyNew[0]["transactionHash"] != consensus.ApplicationActionHash(raw) {
		t.Fatal("new-only log range changed its existing Comet path", failure, onlyNew, oldReads.Load())
	}
	crossFilter := `{"fromBlock":"earliest","toBlock":"latest"}`
	beforeCold, combined, failure := read(crossFilter)
	if failure != "" || len(combined) != len(want)+1 || combined[len(want)]["transactionHash"] != onlyNew[0]["transactionHash"] {
		t.Fatal("cross-boundary log merge lost original order or actual new event", failure, combined)
	}
	filtered := fmt.Sprintf(`{"fromBlock":"earliest","toBlock":"latest","address":%q,"topics":[[%q,%q]]}`, address, event.Topics[0], "0x"+strings.Repeat("0", 64))
	_, matches, failure := read(filtered)
	expected := 1 // The real new IDE event has the same contract event topic.
	for _, log := range want {
		if log.Address == address && len(log.Topics) > 0 && log.Topics[0] == event.Topics[0] {
			expected++
		}
	}
	if failure != "" || len(matches) != expected {
		t.Fatal("original/new address and OR-topic filtering diverged", failure, len(matches), expected)
	}
	mode.Store("pruned")
	oldReads.Store(0)
	newReads.Store(0)
	if _, _, failure := read(crossFilter); !strings.Contains(failure, "unavailable postmigration Comet history") || oldReads.Load() != 0 || newReads.Load() != 0 {
		t.Fatal("a pruned new-history gap was relabeled as an empty original range", failure)
	}
	if _, originals, failure := read(sourceFilter); failure != "" || len(originals) != len(want) || newReads.Load() != 0 {
		t.Fatal("pruned Comet history blocked independent retained source logs", failure)
	}
	mode.Store("")
	newReads.Store(0)
	for _, bad := range []string{"source-http", "block-http", "range", "nil", "anchor", "block-hash", "tx-index", "log-index", "body", "partial-block", "order", "duplicate"} {
		mode.Store(bad)
		if _, _, failure := read(crossFilter); failure == "" || newReads.Load() != 0 {
			t.Fatal("bad original log source returned data or fell back to new history", bad, failure)
		}
	}
	mode.Store("")
	cold, err := consensus.NewPersistentApplicationWithBootstrap(f.migration, f.statePath, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	f.app, live.app = cold, cold
	if afterCold, _, failure := read(crossFilter); failure != "" || !bytes.Equal(beforeCold, afterCold) {
		t.Fatal("cold original/new log read changed event bytes", failure)
	}
	stateAfter, err := os.ReadFile(f.statePath)
	if err != nil {
		t.Fatal(err)
	}
	migrationAfter, err := f.migration.CanonicalJSON()
	if err != nil || !bytes.Equal(stateBefore, stateAfter) || !bytes.Equal(migrationBefore, migrationAfter) {
		t.Fatal("log read or cold recovery rewrote original state/migration", err)
	}
}
