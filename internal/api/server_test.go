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

	var faucetTx map[string]any
	doJSON(t, http.MethodPost, server.URL+"/faucet", map[string]any{"address": "ynx_alice", "amount": 1000}, http.StatusCreated, &faucetTx)
	if faucetTx["type"] != "faucet" {
		t.Fatalf("expected faucet tx, got %v", faucetTx)
	}

	var transferTx map[string]any
	doJSON(t, http.MethodPost, server.URL+"/transfer", map[string]any{"from": "ynx_alice", "to": "ynx_bob", "amount": 125}, http.StatusCreated, &transferTx)
	if transferTx["type"] != "transfer" {
		t.Fatalf("expected transfer tx, got %v", transferTx)
	}

	block := devnet.ProduceBlock()
	if block.Height != 1 {
		t.Fatalf("expected height 1, got %d", block.Height)
	}
	if len(block.Transactions) != 2 {
		t.Fatalf("expected 2 txs in block, got %d", len(block.Transactions))
	}

	var resources map[string]any
	doJSON(t, http.MethodGet, server.URL+"/resources/ynx_alice", nil, http.StatusOK, &resources)
	if resources["address"] != "ynx_alice" {
		t.Fatalf("unexpected resources payload: %v", resources)
	}

	var trace map[string]any
	doJSON(t, http.MethodGet, server.URL+"/trust/trace/ynx_bob", nil, http.StatusOK, &trace)
	lots := trace["lots"].([]any)
	if len(lots) != 1 {
		t.Fatalf("expected one inherited lot, got %v", trace)
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
	if !strings.Contains(body, "session session_a") {
		t.Fatalf("stream did not include requested session: %s", body)
	}
	if !strings.Contains(body, "event: done") {
		t.Fatalf("stream did not complete: %s", body)
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
