package faucet

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestFaucetServiceRequestsAndRateLimits(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	rpc := httptest.NewServer(api.NewServer(devnet))
	defer rpc.Close()

	logPath := t.TempDir() + "/requests.jsonl"
	service, err := New(Config{RPCURL: rpc.URL, FaucetKey: "local-test-key", DefaultAmount: 50, MaxAmount: 100, Window: time.Hour, MaxRequests: 1, RequestLog: logPath})
	if err != nil {
		t.Fatal(err)
	}
	resp, status, err := service.Request(context.Background(), Request{Address: "ynx_faucet_user"}, "127.0.0.1:1000")
	if err != nil || status != http.StatusCreated {
		t.Fatalf("unexpected faucet response status=%d err=%v", status, err)
	}
	if resp.Transaction.Hash == "" || resp.NativeSymbol != "YNXT" || resp.TruthfulStatus != "rpc-backed-faucet" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	_, status, err = service.Request(context.Background(), Request{Address: "ynx_faucet_user"}, "127.0.0.1:1000")
	if err == nil || status != http.StatusTooManyRequests {
		t.Fatalf("expected rate limit, status=%d err=%v", status, err)
	}
	logBytes, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(logBytes), `"status":"sent"`) || !strings.Contains(string(logBytes), `"status":"rate_limited"`) {
		t.Fatalf("request log missing statuses: %s", string(logBytes))
	}
}

func TestFaucetServerEndpoints(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	rpc := httptest.NewServer(api.NewServer(devnet))
	defer rpc.Close()
	service, err := New(Config{RPCURL: rpc.URL, FaucetKey: "local-test-key", DefaultAmount: 25, MaxAmount: 25, Window: time.Second, MaxRequests: 2, RequestLog: t.TempDir() + "/requests.jsonl"})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()
	for _, path := range []string{"/health", "/metrics"} {
		resp, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s returned %d", path, resp.StatusCode)
		}
		_ = resp.Body.Close()
	}
	resp, err := http.Post(server.URL+"/request", "application/json", strings.NewReader(`{"address":"ynx_faucet_server"}`))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("request returned %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
	resp, err = http.Post(server.URL+"/request", "application/json", strings.NewReader(`{"address":"bad"}`))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid address returned %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
}

func TestFaucetRequiresKey(t *testing.T) {
	_, err := New(Config{RPCURL: "http://127.0.0.1:6420"})
	if err == nil || !strings.Contains(err.Error(), "FAUCET_PRIVATE_KEY") {
		t.Fatalf("expected missing key error, got %v", err)
	}
}
