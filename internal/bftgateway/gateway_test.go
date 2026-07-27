package bftgateway

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestGatewayRejectsIncompleteMigrationAnchor(t *testing.T) {
	if _, err := New(Config{CometRPCURL: "http://127.0.0.1:27757", MigrationHeight: 10}); err == nil {
		t.Fatal("gateway accepted migration height without a block hash")
	}
	if _, err := New(Config{CometRPCURL: "http://127.0.0.1:27757", MigrationBlockHash: strings.Repeat("a", 64)}); err == nil {
		t.Fatal("gateway accepted migration block hash without a height")
	}
	if _, err := New(Config{CometRPCURL: "http://127.0.0.1:27757", MigrationHeight: 10, MigrationBlockHash: "bad"}); err == nil {
		t.Fatal("gateway accepted an invalid migration block hash")
	}
}

func TestGatewayMapsCometBFTAndKeepsCutoverBlocked(t *testing.T) {
	privateKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 7))
	recipientKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 8))
	recipient, err := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	signed, err := consensus.NewSignedTransfer(privateKey, 6423, recipient, 25, 1)
	if err != nil {
		t.Fatal(err)
	}
	txPayload, err := consensus.EncodeSignedTransaction(signed)
	if err != nil {
		t.Fatal(err)
	}
	account := chain.ConsensusAccount{Address: signed.From, Balance: 974, Nonce: 1, Lots: map[string]int64{"lot": 974}}
	accountPayload, _ := json.Marshal(account)
	txHash := consensus.SignedTransactionHash(txPayload)
	cometTxHash := strings.ToUpper(strings.TrimPrefix(txHash, "0x"))
	blockTime := time.Date(2026, 7, 12, 1, 2, 3, 0, time.UTC)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/status":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"node_info": map[string]any{"network": "ynx_6423-1"},
				"sync_info": map[string]any{"earliest_block_hash": strings.Repeat("E", 64), "earliest_block_height": "11", "earliest_block_time": blockTime.Add(-6 * time.Second), "latest_block_hash": strings.Repeat("B", 64), "latest_block_height": "17", "latest_block_time": blockTime, "catching_up": false},
			}})
		case "/validators":
			validators := make([]map[string]any, 4)
			for i := range validators {
				validators[i] = map[string]any{
					"address": fmt.Sprintf("%040X", i+1), "voting_power": "1", "proposer_priority": "0",
					"pub_key": map[string]any{"type": "tendermint/PubKeyEd25519", "value": base64.StdEncoding.EncodeToString(make([]byte, 32))},
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"block_height": "17", "validators": validators}})
		case "/block", "/block_by_hash":
			if r.URL.Path == "/block_by_hash" {
				hash := r.URL.Query().Get("hash")
				if hash == "0x"+strings.Repeat("0", 64) {
					w.WriteHeader(http.StatusInternalServerError)
					_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": -32603, "message": "block not found"}})
					return
				}
				if hash != "0x"+strings.Repeat("b", 64) {
					t.Errorf("unexpected block-by-hash query: %s", r.URL.RawQuery)
				}
			} else if r.URL.Query().Get("height") != "17" {
				t.Errorf("unexpected block query: %s", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"block_id": map[string]any{"hash": strings.Repeat("B", 64)},
				"block": map[string]any{
					"header": map[string]any{"height": "17", "time": blockTime, "proposer_address": strings.Repeat("C", 40), "app_hash": strings.Repeat("D", 64), "data_hash": strings.Repeat("A", 64), "last_block_id": map[string]any{"hash": ""}},
					"data":   map[string]any{"txs": []string{base64.StdEncoding.EncodeToString(txPayload)}},
				},
			}})
		case "/block_results":
			if r.URL.Query().Get("height") != "17" {
				t.Errorf("unexpected block results query: %s", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"height": "17", "txs_results": []map[string]any{{"code": 0, "log": "transfer", "gas_used": "1"}},
			}})
		case "/abci_query":
			path, _ := strconv.Unquote(r.URL.Query().Get("path"))
			if path == "/evm/logs" {
				_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{"code": 0, "height": "17", "value": base64.StdEncoding.EncodeToString([]byte("[]"))}}})
				return
			}
			if path == "/accounts/0x0000000000000000000000000000000000000000" {
				_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{"code": 1, "log": "YNX account not found", "height": "17"}}})
				return
			}
			if strings.HasPrefix(path, "/evm/receipts/") {
				_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{"code": 1, "log": "EVM receipt not found", "height": "17"}}})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{"code": 0, "height": "17", "value": base64.StdEncoding.EncodeToString(accountPayload)}}})
		case "/broadcast_tx_commit":
			if r.URL.Query().Get("tx") != fmt.Sprintf("0x%x", txPayload) {
				t.Errorf("unexpected broadcast transaction payload")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"check_tx": map[string]any{"code": 0, "log": ""}, "tx_result": map[string]any{"code": 0, "log": ""},
				"hash": cometTxHash, "height": "17",
			}})
		case "/tx":
			if r.URL.Query().Get("prove") != "true" {
				t.Errorf("unexpected tx lookup query: %s", r.URL.RawQuery)
			}
			if r.URL.Query().Get("hash") != txHash {
				w.WriteHeader(http.StatusInternalServerError)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": -32603, "message": "tx not found"}})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"hash": cometTxHash, "height": "17", "index": 0, "tx_result": map[string]any{"code": 0, "log": "", "gas_used": "1"},
				"tx": base64.StdEncoding.EncodeToString(txPayload),
			}})
		case "/tx_search":
			if r.URL.Query().Get("query") != `"tx.height > 0"` || r.URL.Query().Get("page") != "1" || r.URL.Query().Get("per_page") != "2" || r.URL.Query().Get("order_by") != `"desc"` {
				t.Errorf("unexpected tx search query: %s", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"txs":         []map[string]any{{"hash": cometTxHash, "height": "17", "index": 0, "tx_result": map[string]any{"code": 0, "log": ""}, "tx": base64.StdEncoding.EncodeToString(txPayload)}},
				"total_count": "1",
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	migrationHash := strings.Repeat("F", 64)
	gateway, err := New(Config{CometRPCURL: upstream.URL, Build: buildinfo.Info{Commit: "abc123", Release: "bft-gateway-abc123", BuildTime: "2026-07-12T00:00:00Z"}, MigrationHeight: 16, MigrationBlockHash: migrationHash})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()

	var health Health
	getJSON(t, server.URL+"/health", &health)
	if !health.OK || health.PublicCutoverReady || health.ValidatorCount != 4 || health.Height != 17 || len(health.Implemented) != 27 || len(health.Missing) != 0 || health.Build.Commit != "abc123" || health.MigrationHeight != 16 || health.MigrationBlockHash != strings.ToLower(migrationHash) {
		t.Fatalf("unexpected health: %+v", health)
	}
	var status Status
	getJSON(t, server.URL+"/status", &status)
	if status.ChainID != 6423 || status.CometChainID != "ynx_6423-1" || status.ConsensusEngine != "cometbft" || status.EarliestBlockHeight != 11 || status.EarliestBlockHash != strings.Repeat("e", 64) || status.PublicCutoverReady || status.MigrationHeight != 16 || status.MigrationBlockHash != strings.ToLower(migrationHash) {
		t.Fatalf("unexpected status: %+v", status)
	}
	var block chain.Block
	getJSON(t, server.URL+"/blocks/17", &block)
	if block.Height != 17 || block.ParentHash != strings.ToLower(migrationHash) || len(block.Transactions) != 1 || block.Transactions[0].From != signed.From || block.Transactions[0].Hash != consensus.SignedTransactionHash(txPayload) {
		t.Fatalf("unexpected block: %+v", block)
	}
	var queried chain.ConsensusAccount
	getJSON(t, server.URL+"/accounts/"+signed.From, &queried)
	if queried.Address != signed.From || queried.Balance != 974 || queried.Nonce != 1 {
		t.Fatalf("unexpected account: %+v", queried)
	}
	var validators map[string]any
	getJSON(t, server.URL+"/validators", &validators)
	if len(validators["validators"].([]any)) != 4 {
		t.Fatalf("unexpected validators: %+v", validators)
	}

	resp, err := http.Post(server.URL+"/transactions/broadcast", "application/json", strings.NewReader(string(txPayload)))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var broadcast BroadcastResponse
	if resp.StatusCode != http.StatusOK {
		payload, _ := io.ReadAll(resp.Body)
		t.Fatalf("broadcast returned %d: %s", resp.StatusCode, payload)
	}
	if err := json.NewDecoder(resp.Body).Decode(&broadcast); err != nil {
		t.Fatal(err)
	}
	if !broadcast.Committed || broadcast.Height != 17 || broadcast.Transaction.Hash != txHash || broadcast.CometHash != strings.ToLower(cometTxHash) {
		t.Fatalf("unexpected broadcast response: %+v", broadcast)
	}
	var lookedUp chain.Transaction
	getJSON(t, server.URL+"/txs/"+txHash, &lookedUp)
	if lookedUp.Hash != txHash || lookedUp.BlockNum != 17 || lookedUp.From != signed.From {
		t.Fatalf("unexpected transaction lookup: %+v", lookedUp)
	}
	var listed TransactionList
	getJSON(t, server.URL+"/txs?page=1&limit=2", &listed)
	if listed.Total != 1 || listed.NextPage != nil || len(listed.Transactions) != 1 || listed.Transactions[0].Hash != txHash {
		t.Fatalf("unexpected transaction list: %+v", listed)
	}

	assertPostStatus(t, server.URL+"/transactions/broadcast", "application/json", string(txPayload)+"\n", http.StatusBadRequest)
	wrongChain, err := consensus.NewSignedTransfer(privateKey, 1, recipient, 25, 2)
	if err != nil {
		t.Fatal(err)
	}
	wrongChainPayload, _ := consensus.EncodeSignedTransaction(wrongChain)
	assertPostStatus(t, server.URL+"/transactions/broadcast", "application/json", string(wrongChainPayload), http.StatusUnprocessableEntity)
	assertPostStatus(t, server.URL+"/transactions/broadcast", "text/plain", string(txPayload), http.StatusUnsupportedMediaType)
	assertPostStatus(t, server.URL+"/transactions/broadcast", "application/json", strings.Repeat("x", consensus.MaxSignedTransactionSize+1), http.StatusRequestEntityTooLarge)
	assertGetStatus(t, server.URL+"/txs/0x"+strings.Repeat("A", 64), http.StatusBadRequest)
	assertGetStatus(t, server.URL+"/txs?limit=101", http.StatusBadRequest)

	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}`, "0x1917")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":11,"method":"net_version","params":[]}`, "6423")
	assertRPCResult(t, server.URL+"/", `{"jsonrpc":"2.0","id":2,"method":"eth_chainId","params":[]}`, "0x1917")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":2,"method":"eth_blockNumber","params":[]}`, "0x11")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":39,"method":"eth_gasPrice","params":[]}`, "0x1")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":40,"method":"eth_maxPriorityFeePerGas"}`, "0x1")
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":41,"method":"eth_gasPrice","params":["latest"]}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":42,"method":"eth_maxPriorityFeePerGas","params":{}}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":43,"method":"eth_gasPrice","params":null}`, -32602)
	assertRPCResult(t, server.URL+"/evm", fmt.Sprintf(`{"jsonrpc":"2.0","id":25,"method":"eth_sendRawTransaction","params":["0x%x"]}`, txPayload), txHash)
	assertRPCResult(t, server.URL+"/evm", fmt.Sprintf(`{"jsonrpc":"2.0","id":12,"method":"eth_getBalance","params":[%q,"latest"]}`, signed.From), "0x3ce")
	assertRPCResult(t, server.URL+"/evm", fmt.Sprintf(`{"jsonrpc":"2.0","id":13,"method":"eth_getTransactionCount","params":[%q,"finalized"]}`, signed.From), "0x1")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":14,"method":"eth_getBalance","params":["0x0000000000000000000000000000000000000000","0x11"]}`, "0x0")
	evmBlock := assertRPCObject(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":17,"method":"eth_getBlockByNumber","params":["latest",false]}`)
	evmBlockTransactions := evmBlock["transactions"].([]any)
	if evmBlock["number"] != "0x11" || evmBlock["hash"] != "0x"+strings.Repeat("b", 64) || evmBlock["parentHash"] != "0x"+strings.Repeat("f", 64) || evmBlock["stateRoot"] != "0x"+strings.Repeat("d", 64) || evmBlock["transactionsRoot"] != "0x"+strings.Repeat("a", 64) || evmBlock["miner"] != "0x"+strings.Repeat("c", 40) || evmBlock["gasUsed"] != "0x1" || evmBlock["transactionCount"] != "0x1" || len(evmBlockTransactions) != 1 || evmBlockTransactions[0] != txHash {
		t.Fatalf("unexpected committed EVM block: %+v", evmBlock)
	}
	fullEVMBlock := assertRPCObject(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":18,"method":"eth_getBlockByHash","params":["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",true]}`)
	fullEVMTransactions := fullEVMBlock["transactions"].([]any)
	if len(fullEVMTransactions) != 1 || fullEVMTransactions[0].(map[string]any)["hash"] != txHash || fullEVMTransactions[0].(map[string]any)["transactionIndex"] != "0x0" {
		t.Fatalf("unexpected full committed EVM block: %+v", fullEVMBlock)
	}
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":19,"method":"eth_getBlockByNumber","params":["pending",false]}`, nil)
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":20,"method":"eth_getBlockByNumber","params":["0x12",false]}`, nil)
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":21,"method":"eth_getBlockByHash","params":["0x0000000000000000000000000000000000000000000000000000000000000000",false]}`, nil)
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":28,"method":"eth_getBlockTransactionCountByNumber","params":["latest"]}`, "0x1")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":29,"method":"eth_getBlockTransactionCountByHash","params":["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]}`, "0x1")
	byNumber := assertRPCObject(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":30,"method":"eth_getTransactionByBlockNumberAndIndex","params":["0x11","0x0"]}`)
	if byNumber["hash"] != txHash || byNumber["transactionIndex"] != "0x0" || byNumber["blockNumber"] != "0x11" {
		t.Fatalf("unexpected block-number transaction lookup: %+v", byNumber)
	}
	byHash := assertRPCObject(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":31,"method":"eth_getTransactionByBlockHashAndIndex","params":["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","0x0"]}`)
	if byHash["hash"] != txHash || byHash["transactionIndex"] != "0x0" || byHash["blockHash"] != "0x"+strings.Repeat("b", 64) {
		t.Fatalf("unexpected block-hash transaction lookup: %+v", byHash)
	}
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":32,"method":"eth_getBlockTransactionCountByNumber","params":["pending"]}`, nil)
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":33,"method":"eth_getTransactionByBlockNumberAndIndex","params":["latest","0x1"]}`, nil)
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":34,"method":"eth_getBlockTransactionCountByHash","params":["0x0000000000000000000000000000000000000000000000000000000000000000"]}`, nil)
	transaction := assertRPCObject(t, server.URL+"/evm", fmt.Sprintf(`{"jsonrpc":"2.0","id":3,"method":"eth_getTransactionByHash","params":[%q]}`, txHash))
	if transaction["hash"] != txHash || transaction["transactionIndex"] != "0x0" || transaction["blockNumber"] != "0x11" || transaction["input"] != "0x" {
		t.Fatalf("unexpected committed EVM transaction: %+v", transaction)
	}
	receipt := assertRPCObject(t, server.URL+"/evm", fmt.Sprintf(`{"jsonrpc":"2.0","id":4,"method":"eth_getTransactionReceipt","params":[%q]}`, txHash))
	if receipt["transactionHash"] != txHash || receipt["gasUsed"] != "0x1" || receipt["status"] != "0x1" || len(receipt["logs"].([]any)) != 0 || len(receipt["logsBloom"].(string)) != 514 {
		t.Fatalf("unexpected committed EVM receipt: %+v", receipt)
	}
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":5,"method":"eth_getLogs","params":[{"fromBlock":"0xb","toBlock":"0x11"}]}`, []any{})
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":6,"method":"eth_getLogs","params":[{"address":"0x0000000000000000000000000000000000000001","topics":["0x0000000000000000000000000000000000000000000000000000000000000001"]}]}`, []any{})
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":7,"method":"eth_getTransactionReceipt","params":["0x0000000000000000000000000000000000000000000000000000000000000000"]}`, nil)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":8,"method":"eth_getLogs","params":[{"fromBlock":"0x11","toBlock":"0x10"}]}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":9,"method":"eth_getLogs","params":[{"address":"0xBAD"}]}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":10,"method":"eth_getTransactionReceipt","params":["0xBAD"]}`, -32602)
	assertRPCError(t, server.URL+"/evm", fmt.Sprintf(`{"jsonrpc":"2.0","id":15,"method":"eth_getBalance","params":[%q,"0x10"]}`, signed.From), -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":16,"method":"eth_getTransactionCount","params":["0xBAD","latest"]}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":22,"method":"eth_getBlockByNumber","params":["0x011",false]}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":23,"method":"eth_getBlockByHash","params":["0xBAD",false]}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":24,"method":"eth_getBlockByNumber","params":["latest","false"]}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":35,"method":"eth_getBlockTransactionCountByNumber","params":["0x011"]}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":36,"method":"eth_getBlockTransactionCountByHash","params":["0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"]}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":37,"method":"eth_getTransactionByBlockNumberAndIndex","params":["latest","0x00"]}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":38,"method":"eth_getTransactionByBlockHashAndIndex","params":["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]}`, -32602)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":26,"method":"eth_sendRawTransaction","params":["0x0"]}`, -32602)
	assertRPCError(t, server.URL+"/evm", fmt.Sprintf(`{"jsonrpc":"2.0","id":27,"method":"eth_sendRawTransaction","params":["0x%x"]}`, wrongChainPayload), -32003)
	resp, err = http.Post(server.URL+"/evm", "application/json", strings.NewReader(`{"jsonrpc":"2.0","id":3,"method":"eth_getStorageAt","params":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var unsupported map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&unsupported); err != nil {
		t.Fatal(err)
	}
	if unsupported["error"].(map[string]any)["code"] != float64(-32601) {
		t.Fatalf("unsupported EVM method did not fail closed: %+v", unsupported)
	}

	if _, err := gateway.status(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestEVMSendRawTransactionMapsCometReplayRejection(t *testing.T) {
	privateKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 9))
	recipientKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 10))
	recipient, err := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	signed, err := consensus.NewSignedTransfer(privateKey, 6423, recipient, 5, 1)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := consensus.EncodeSignedTransaction(signed)
	if err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/broadcast_tx_commit" || r.URL.Query().Get("tx") != fmt.Sprintf("0x%x", payload) {
			t.Errorf("unexpected replay request: %s?%s", r.URL.Path, r.URL.RawQuery)
			http.Error(w, "unexpected replay request", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
			"check_tx":  map[string]any{"code": 4, "log": "invalid nonce replay", "gas_used": "0"},
			"tx_result": map[string]any{"code": 0, "log": "", "gas_used": "0"},
		}})
	}))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()
	assertRPCError(t, server.URL+"/evm", fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":["0x%x"]}`, payload), -32003)
}

func TestEVMBlockTransactionLookupsClassifyUpstreamFailures(t *testing.T) {
	blockTime := time.Date(2026, 7, 12, 1, 2, 3, 0, time.UTC)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/status":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"node_info": map[string]any{"network": "ynx_6423-1"},
				"sync_info": map[string]any{
					"earliest_block_hash":   strings.Repeat("E", 64),
					"earliest_block_height": "11",
					"earliest_block_time":   blockTime.Add(-6 * time.Second),
					"latest_block_hash":     strings.Repeat("B", 64),
					"latest_block_height":   "17",
					"latest_block_time":     blockTime,
					"catching_up":           false,
				},
			}})
		case "/validators":
			validators := make([]map[string]any, 4)
			for i := range validators {
				validators[i] = map[string]any{
					"address": fmt.Sprintf("%040X", i+1), "voting_power": "1", "proposer_priority": "0",
					"pub_key": map[string]any{"type": "tendermint/PubKeyEd25519", "value": base64.StdEncoding.EncodeToString(make([]byte, 32))},
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"block_height": "17", "validators": validators}})
		case "/block", "/block_by_hash":
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": -32603, "message": "upstream evidence unavailable"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()

	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":1,"method":"eth_getBlockTransactionCountByNumber","params":["latest"]}`, -32603)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":2,"method":"eth_getTransactionByBlockHashAndIndex","params":["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","0x0"]}`, -32603)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":3,"method":"eth_getBlockTransactionCountByNumber","params":["0x011"]}`, -32602)
}

func TestGatewayBroadcastsAndResolvesEthereumLegacyTransferByEthereumHash(t *testing.T) {
	senderBytes := make([]byte, 32)
	senderBytes[31] = 41
	recipientBytes := make([]byte, 32)
	recipientBytes[31] = 42
	senderKey := secp256k1.PrivKeyFromBytes(senderBytes)
	recipient, err := consensus.NativeAddress(secp256k1.PrivKeyFromBytes(recipientBytes).PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	payload, ethereumTx, err := consensus.NewEthereumLegacyTransfer(senderKey, 6423, 0, 2, recipient, 125)
	if err != nil {
		t.Fatal(err)
	}
	cometHash := strings.ToUpper(strings.TrimPrefix(consensus.SignedTransactionHash(payload), "0x"))
	blockHash := strings.Repeat("B", 64)
	parentHash := strings.Repeat("A", 64)
	appHash := strings.Repeat("C", 64)
	dataHash := strings.Repeat("D", 64)
	blockTime := time.Date(2026, 7, 27, 8, 45, 0, 0, time.UTC)
	receipt := consensus.BFTEVMReceipt{
		TxHash: ethereumTx.Hash, From: ethereumTx.From, To: ethereumTx.To,
		Action: consensus.EthereumLegacyTransferType, Status: "success", EncodedResult: "0x",
		Logs: []consensus.BFTEVMLog{}, BlockHeight: 17,
	}
	receipt.AuditHash = consensus.BFTEVMReceiptAuditHash(receipt)
	receiptPayload, _ := json.Marshal(receipt)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/broadcast_tx_commit":
			if r.URL.Query().Get("tx") != "0x"+fmt.Sprintf("%x", payload) {
				t.Errorf("unexpected broadcast payload: %s", r.URL.Query().Get("tx"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"check_tx":  map[string]any{"code": 0, "gas_used": "21000"},
				"tx_result": map[string]any{"code": 0, "gas_used": "21000"},
				"hash":      cometHash, "height": "17",
			}})
		case "/tx":
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": -32603, "message": "tx not found"}})
		case "/abci_query":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{
				"code": 0, "height": "17", "value": base64.StdEncoding.EncodeToString(receiptPayload),
			}}})
		case "/block":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"block_id": map[string]any{"hash": blockHash},
				"block": map[string]any{
					"header": map[string]any{
						"height": "17", "time": blockTime, "proposer_address": strings.Repeat("1", 40),
						"app_hash": appHash, "data_hash": dataHash, "last_block_id": map[string]any{"hash": parentHash},
					},
					"data": map[string]any{"txs": [][]byte{payload}},
				},
			}})
		case "/block_results":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"height": "17", "txs_results": []map[string]any{{"code": 0, "gas_used": "21000"}},
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}

	broadcast, err := gateway.broadcastSignedTransaction(context.Background(), payload)
	if err != nil {
		t.Fatal(err)
	}
	if broadcast.Transaction.Hash != ethereumTx.Hash || broadcast.CometHash != strings.ToLower(cometHash) || broadcast.Transaction.Nonce != 0 || broadcast.Transaction.Fee != 42_000 {
		t.Fatalf("Ethereum and Comet transaction identities were conflated: %+v", broadcast)
	}
	upstreamTx, mapped, found, err := gateway.committedTransaction(context.Background(), ethereumTx.Hash)
	if err != nil || !found {
		t.Fatalf("Ethereum-hash committed lookup failed: mapped=%+v err=%v", mapped, err)
	}
	if upstreamTx.Hash != cometHash || !reflect.DeepEqual(upstreamTx.Tx, payload) || mapped.Hash != ethereumTx.Hash || mapped.BlockNum != 17 {
		t.Fatalf("Ethereum committed evidence mismatch: upstream=%+v mapped=%+v", upstreamTx, mapped)
	}
	transactionObject := evmCommittedTransaction(mapped, upstreamTx.Index, upstreamTx.Tx)
	if transactionObject["hash"] != ethereumTx.Hash || transactionObject["nonce"] != "0x0" || transactionObject["gas"] != "0x5208" || transactionObject["gasPrice"] != "0x2" || transactionObject["value"] != "0x7d" {
		t.Fatalf("Ethereum transaction object is not truthful: %+v", transactionObject)
	}
	receiptObject := evmCommittedReceipt(mapped, upstreamTx.Index, 21_000, 21_000, upstreamTx.Tx)
	if receiptObject["transactionHash"] != ethereumTx.Hash || receiptObject["effectiveGasPrice"] != "0x2" || receiptObject["gasUsed"] != "0x5208" {
		t.Fatalf("Ethereum receipt object is not truthful: %+v", receiptObject)
	}
	result, code, err := gateway.evmSendRawTransaction(context.Background(), json.RawMessage(fmt.Sprintf(`["0x%x"]`, payload)))
	if err != nil || code != 0 || result != ethereumTx.Hash {
		t.Fatalf("eth_sendRawTransaction did not return Ethereum Keccak hash: result=%v code=%d err=%v", result, code, err)
	}
	if _, _, err := gateway.evmSendRawTransaction(context.Background(), json.RawMessage(`["0x02c0"]`)); err == nil {
		t.Fatal("typed Ethereum transaction was accepted")
	}
}

func TestPublicCutoverReadyRequiresAuthorizationAndReleaseIdentity(t *testing.T) {
	validBuild := buildinfo.Info{
		Commit:    "abcdef123456",
		Release:   "ynx-bft-gateway-abcdef123456",
		BuildTime: "2026-07-12T04:00:00Z",
	}
	tests := []struct {
		name       string
		authorized bool
		build      buildinfo.Info
		want       bool
	}{
		{name: "authorized release", authorized: true, build: validBuild, want: true},
		{name: "authorization defaults closed", build: validBuild},
		{name: "unknown build", authorized: true, build: buildinfo.Info{}},
		{name: "short commit", authorized: true, build: buildinfo.Info{Commit: "abcdef", Release: "ynx-bft-gateway-abcdef", BuildTime: validBuild.BuildTime}},
		{name: "uppercase commit", authorized: true, build: buildinfo.Info{Commit: "ABCDEF123456", Release: "ynx-bft-gateway-ABCDEF123456", BuildTime: validBuild.BuildTime}},
		{name: "release mismatch", authorized: true, build: buildinfo.Info{Commit: validBuild.Commit, Release: "ynx-bft-gateway-other", BuildTime: validBuild.BuildTime}},
		{name: "invalid build time", authorized: true, build: buildinfo.Info{Commit: validBuild.Commit, Release: validBuild.Release, BuildTime: "unknown"}},
		{name: "non UTC build time", authorized: true, build: buildinfo.Info{Commit: validBuild.Commit, Release: validBuild.Release, BuildTime: "2026-07-12T12:00:00+08:00"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gateway, err := New(Config{
				CometRPCURL:             "http://127.0.0.1:27757",
				Build:                   tt.build,
				PublicCutoverAuthorized: tt.authorized,
			})
			if err != nil {
				t.Fatal(err)
			}
			if got := gateway.publicCutoverReady(); got != tt.want {
				t.Fatalf("publicCutoverReady() = %t, want %t", got, tt.want)
			}
		})
	}
}

func assertRPCObject(t *testing.T, endpoint, payload string) map[string]any {
	t.Helper()
	resp, err := http.Post(endpoint, "application/json", strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	result, ok := out["result"].(map[string]any)
	if !ok {
		t.Fatalf("expected JSON-RPC object result: %+v", out)
	}
	return result
}

func assertRPCError(t *testing.T, endpoint, payload string, code int) {
	t.Helper()
	resp, err := http.Post(endpoint, "application/json", strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	errorObject, ok := out["error"].(map[string]any)
	if !ok || errorObject["code"] != float64(code) {
		t.Fatalf("expected JSON-RPC error %d: %+v", code, out)
	}
}

func TestGatewayBroadcastFailsClosedOnCometRejectionAndHashMismatch(t *testing.T) {
	privateKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 9))
	recipientKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 10))
	recipient, _ := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	signed, _ := consensus.NewSignedTransfer(privateKey, 6423, recipient, 10, 1)
	payload, _ := consensus.EncodeSignedTransaction(signed)

	for _, tc := range []struct {
		name       string
		result     map[string]any
		wantStatus int
	}{
		{name: "rejected", result: map[string]any{"check_tx": map[string]any{"code": 7, "log": "invalid nonce"}, "tx_result": map[string]any{"code": 0}, "hash": strings.Repeat("A", 64), "height": "17"}, wantStatus: http.StatusUnprocessableEntity},
		{name: "hash mismatch", result: map[string]any{"check_tx": map[string]any{"code": 0}, "tx_result": map[string]any{"code": 0}, "hash": strings.Repeat("A", 64), "height": "17"}, wantStatus: http.StatusBadGateway},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewEncoder(w).Encode(map[string]any{"result": tc.result})
			}))
			defer upstream.Close()
			gateway, err := New(Config{CometRPCURL: upstream.URL})
			if err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(gateway.Handler())
			defer server.Close()
			assertPostStatus(t, server.URL+"/transactions/broadcast", "application/json", string(payload), tc.wantStatus)
		})
	}
}

func getJSON(t *testing.T, endpoint string, out any) {
	t.Helper()
	resp, err := http.Get(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		payload, _ := io.ReadAll(resp.Body)
		t.Fatalf("GET %s returned %d: %s", endpoint, resp.StatusCode, payload)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		t.Fatal(err)
	}
}

func assertRPCResult(t *testing.T, endpoint, body string, expected any) {
	t.Helper()
	resp, err := http.Post(endpoint, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(payload["result"], expected) {
		t.Fatalf("unexpected JSON-RPC response: %+v", payload)
	}
}

func assertPostStatus(t *testing.T, endpoint, contentType, body string, expected int) {
	t.Helper()
	resp, err := http.Post(endpoint, contentType, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expected {
		payload, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST %s returned %d, want %d: %s", endpoint, resp.StatusCode, expected, payload)
	}
}

func assertGetStatus(t *testing.T, endpoint string, expected int) {
	t.Helper()
	resp, err := http.Get(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expected {
		payload, _ := io.ReadAll(resp.Body)
		t.Fatalf("GET %s returned %d, want %d: %s", endpoint, resp.StatusCode, expected, payload)
	}
}
