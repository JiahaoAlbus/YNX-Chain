package bftgateway

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

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
				"sync_info": map[string]any{"earliest_block_hash": strings.Repeat("E", 64), "earliest_block_height": "11", "earliest_block_time": blockTime.Add(-6 * time.Second), "latest_block_hash": strings.Repeat("A", 64), "latest_block_height": "17", "latest_block_time": blockTime, "catching_up": false},
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
		case "/block":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"block_id": map[string]any{"hash": strings.Repeat("B", 64)},
				"block": map[string]any{
					"header": map[string]any{"height": "17", "time": blockTime, "proposer_address": strings.Repeat("C", 40), "last_block_id": map[string]any{"hash": strings.Repeat("D", 64)}},
					"data":   map[string]any{"txs": []string{base64.StdEncoding.EncodeToString(txPayload)}},
				},
			}})
		case "/abci_query":
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
			if r.URL.Query().Get("hash") != txHash || r.URL.Query().Get("prove") != "true" {
				t.Errorf("unexpected tx lookup query: %s", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"hash": cometTxHash, "height": "17", "index": 0, "tx_result": map[string]any{"code": 0, "log": ""},
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

	gateway, err := New(Config{CometRPCURL: upstream.URL, Build: buildinfo.Info{Commit: "abc123", Release: "bft-gateway-abc123", BuildTime: "2026-07-12T00:00:00Z"}})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()

	var health Health
	getJSON(t, server.URL+"/health", &health)
	if !health.OK || health.PublicCutoverReady || health.ValidatorCount != 4 || health.Height != 17 || len(health.Implemented) != 9 || len(health.Missing) != 6 || health.Build.Commit != "abc123" {
		t.Fatalf("unexpected health: %+v", health)
	}
	var status Status
	getJSON(t, server.URL+"/status", &status)
	if status.ChainID != 6423 || status.CometChainID != "ynx_6423-1" || status.ConsensusEngine != "cometbft" || status.EarliestBlockHeight != 11 || status.EarliestBlockHash != strings.Repeat("e", 64) || status.PublicCutoverReady {
		t.Fatalf("unexpected status: %+v", status)
	}
	var block chain.Block
	getJSON(t, server.URL+"/blocks/17", &block)
	if block.Height != 17 || len(block.Transactions) != 1 || block.Transactions[0].From != signed.From || block.Transactions[0].Hash != consensus.SignedTransactionHash(txPayload) {
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
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":2,"method":"eth_blockNumber","params":[]}`, "0x11")
	resp, err = http.Post(server.URL+"/evm", "application/json", strings.NewReader(`{"jsonrpc":"2.0","id":3,"method":"eth_getBalance","params":[]}`))
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

func assertRPCResult(t *testing.T, endpoint, body, expected string) {
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
	if payload["result"] != expected {
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
