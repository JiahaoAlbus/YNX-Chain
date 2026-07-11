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
	blockTime := time.Date(2026, 7, 12, 1, 2, 3, 0, time.UTC)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/status":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"node_info": map[string]any{"network": "ynx_6423-1"},
				"sync_info": map[string]any{"latest_block_hash": strings.Repeat("A", 64), "latest_block_height": "17", "latest_block_time": blockTime, "catching_up": false},
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
	if !health.OK || health.PublicCutoverReady || health.ValidatorCount != 4 || health.Height != 17 || len(health.Missing) == 0 || health.Build.Commit != "abc123" {
		t.Fatalf("unexpected health: %+v", health)
	}
	var status Status
	getJSON(t, server.URL+"/status", &status)
	if status.ChainID != 6423 || status.CometChainID != "ynx_6423-1" || status.ConsensusEngine != "cometbft" || status.PublicCutoverReady {
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

	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}`, "0x1917")
	assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":2,"method":"eth_blockNumber","params":[]}`, "0x11")
	resp, err := http.Post(server.URL+"/evm", "application/json", strings.NewReader(`{"jsonrpc":"2.0","id":3,"method":"eth_getBalance","params":[]}`))
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
