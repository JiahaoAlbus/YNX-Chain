package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestDevnetAPIFlow(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("devnet"))
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()
	var status map[string]any
	doJSON(t, http.MethodGet, server.URL+"/status", nil, http.StatusOK, &status)
	if status["chainId"].(float64) != 6425 {
		t.Fatalf("expected devnet chain ID 6425, got %v", status["chainId"])
	}
	if status["nativeCurrencySymbol"] != "YNXT" {
		t.Fatalf("expected YNXT, got %v", status["nativeCurrencySymbol"])
	}
	var faucetTx map[string]any
	doJSON(t, http.MethodPost, server.URL+"/faucet", map[string]any{"address": "ynx_alice", "amount": 1000}, http.StatusCreated, &faucetTx)
	var transferTx map[string]any
	doJSON(t, http.MethodPost, server.URL+"/transfer", map[string]any{"from": "ynx_alice", "to": "ynx_bob", "amount": 125}, http.StatusCreated, &transferTx)
	block := devnet.ProduceBlock()
	if block.Height != 1 || len(block.Transactions) != 2 {
		t.Fatalf("unexpected block: %+v", block)
	}
	var trace map[string]any
	doJSON(t, http.MethodGet, server.URL+"/trust/trace/ynx_bob", nil, http.StatusOK, &trace)
	if len(trace["lots"].([]any)) != 1 {
		t.Fatalf("expected inherited lot: %v", trace)
	}
	var summary map[string]any
	doJSON(t, http.MethodGet, server.URL+"/explorer/summary", nil, http.StatusOK, &summary)
	if summary["totalTransactions"].(float64) != 2 {
		t.Fatalf("summary did not count txs: %v", summary)
	}
}

func TestEVMRPCSubset(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()
	var out map[string]any
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []any{}}, http.StatusOK, &out)
	if out["result"] != "0x1917" {
		t.Fatalf("expected 0x1917 for chainId 6423, got %v", out)
	}
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 2, "method": "eth_blockNumber", "params": []any{}}, http.StatusOK, &out)
	if out["result"] == "" {
		t.Fatalf("missing block number: %v", out)
	}
}

func TestAIStreamIsSessionScoped(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("devnet"))
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()
	resp, err := http.Get(server.URL + "/ai/stream?session=session_a&q=hello")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(resp.Body)
	body := buf.String()
	if !strings.Contains(body, "session session_a") || !strings.Contains(body, "event: done") {
		t.Fatalf("bad stream: %s", body)
	}
}

func TestIDEPreflightTruthfulFailure(t *testing.T) {
	result := preflightContract("Bad", "function nope() public {}")
	if result.OK {
		t.Fatal("expected preflight failure")
	}
	if !strings.Contains(result.TruthfulNote, "preflight") {
		t.Fatalf("missing truthful note: %s", result.TruthfulNote)
	}
}

func doJSON(t *testing.T, method, url string, body any, expected int, out any) {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(payload)
	} else {
		reader = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expected {
		t.Fatalf("expected status %d, got %d", expected, resp.StatusCode)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
}
