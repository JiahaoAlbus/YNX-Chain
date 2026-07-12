package faucet

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
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
	server := httptest.NewServer(NewServerWithBuild(service, buildinfo.Info{Commit: "abc123", Release: "ynx-chain-abc123", BuildTime: "2026-07-10T00:00:00Z"}).Handler())
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
	resp, err = http.Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	var health Health
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if health.Build.Commit != "abc123" || health.Build.Release != "ynx-chain-abc123" || health.Build.BuildTime != "2026-07-10T00:00:00Z" {
		t.Fatalf("health missing build identity: %+v", health.Build)
	}
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

func TestBFTFaucetSignsLocallyAndSerializesConcurrentNonces(t *testing.T) {
	privateKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 21))
	faucetAddress, _ := consensus.NativeAddress(privateKey.PubKey().SerializeCompressed())
	recipientOne := nativeAddress(t, 22)
	recipientTwo := nativeAddress(t, 23)

	var mu sync.Mutex
	account := chain.ConsensusAccount{Address: faucetAddress, Balance: 100, Lots: map[string]int64{"faucet": 100}}
	observedNonces := []uint64{}
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/status":
			_ = json.NewEncoder(w).Encode(map[string]any{"chainId": 6423, "height": 50, "nativeCurrencySymbol": "YNXT"})
		case r.Method == http.MethodGet && r.URL.Path == "/accounts/"+faucetAddress:
			mu.Lock()
			current := account
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(current)
		case r.Method == http.MethodPost && r.URL.Path == "/transactions/broadcast":
			payload, err := io.ReadAll(r.Body)
			if err != nil {
				t.Error(err)
				return
			}
			signed, err := consensus.DecodeSignedTransaction(payload)
			if err != nil || signed.Verify(6423) != nil {
				t.Errorf("invalid signed transaction: %v", err)
				return
			}
			mu.Lock()
			if signed.Nonce != account.Nonce+1 {
				mu.Unlock()
				w.WriteHeader(http.StatusUnprocessableEntity)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "stale nonce"})
				return
			}
			account.Nonce = signed.Nonce
			account.Balance -= signed.Amount + signed.Fee
			observedNonces = append(observedNonces, signed.Nonce)
			mu.Unlock()
			hash := consensus.SignedTransactionHash(payload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"transaction": chain.Transaction{Hash: hash, Type: signed.Type, From: signed.From, To: signed.To, Amount: signed.Amount, Fee: signed.Fee, Nonce: signed.Nonce, BlockHash: strings.Repeat("a", 64), BlockNum: 51, Timestamp: time.Now().UTC()},
				"committed":   true, "height": 51, "cometHash": strings.TrimPrefix(hash, "0x"), "truthfulStatus": "cometbft-broadcast-commit",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer gateway.Close()

	logPath := t.TempDir() + "/bft-requests.jsonl"
	service, err := New(Config{RPCURL: gateway.URL, UpstreamMode: UpstreamBFT, FaucetKey: "0x" + hex.EncodeToString(privateKey.Serialize()), FaucetAddress: faucetAddress, ChainID: 6423, DefaultAmount: 10, MaxAmount: 10, Window: time.Hour, MaxRequests: 1, RequestLog: logPath})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errors := make(chan error, 2)
	for index, recipient := range []string{recipientOne, recipientTwo} {
		wg.Add(1)
		go func(index int, recipient string) {
			defer wg.Done()
			response, status, err := service.Request(context.Background(), Request{Address: recipient}, fmt.Sprintf("127.0.0.%d:9000", index+1))
			if err != nil || status != http.StatusCreated || response.Transaction.To != recipient || response.TruthfulStatus != "bft-gateway-signed-faucet" {
				errors <- fmt.Errorf("recipient=%s status=%d response=%+v err=%v", recipient, status, response, err)
			}
		}(index, recipient)
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		t.Error(err)
	}
	mu.Lock()
	sort.Slice(observedNonces, func(i, j int) bool { return observedNonces[i] < observedNonces[j] })
	if fmt.Sprint(observedNonces) != "[1 2]" || account.Nonce != 2 || account.Balance != 78 {
		t.Fatalf("unexpected serialized state nonces=%v account=%+v", observedNonces, account)
	}
	mu.Unlock()
	logPayload, err := os.ReadFile(logPath)
	if err != nil || strings.Count(string(logPayload), `"status":"sent"`) != 2 {
		t.Fatalf("BFT request log is incomplete: %v %s", err, logPayload)
	}
	health := service.CheckHealth(context.Background())
	if !health.OK || !health.UpstreamOK || health.UpstreamMode != UpstreamBFT || health.FaucetAddress != faucetAddress || health.TruthfulStatus != "bft-gateway-signed-faucet" {
		t.Fatalf("unexpected BFT health: %+v", health)
	}
}

func TestBFTFaucetFailsClosedOnInconsistentGatewayResponse(t *testing.T) {
	privateKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 31))
	faucetAddress, _ := consensus.NativeAddress(privateKey.PubKey().SerializeCompressed())
	recipient := nativeAddress(t, 32)

	for _, field := range []string{"hash", "from", "to", "amount", "nonce", "height", "cometHash", "committed"} {
		t.Run(field, func(t *testing.T) {
			gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.Method == http.MethodGet {
					_ = json.NewEncoder(w).Encode(chain.ConsensusAccount{Address: faucetAddress, Balance: 100, Nonce: 0})
					return
				}
				payload, _ := io.ReadAll(r.Body)
				signed, _ := consensus.DecodeSignedTransaction(payload)
				hash := consensus.SignedTransactionHash(payload)
				tx := chain.Transaction{Hash: hash, Type: signed.Type, From: signed.From, To: signed.To, Amount: signed.Amount, Fee: signed.Fee, Nonce: signed.Nonce, BlockNum: 10, Timestamp: time.Now().UTC()}
				result := map[string]any{"transaction": tx, "committed": true, "height": 10, "cometHash": strings.TrimPrefix(hash, "0x"), "truthfulStatus": "cometbft-broadcast-commit"}
				switch field {
				case "hash":
					tx.Hash = "0x" + strings.Repeat("0", 64)
				case "from":
					tx.From = recipient
				case "to":
					tx.To = faucetAddress
				case "amount":
					tx.Amount++
				case "nonce":
					tx.Nonce++
				case "height":
					result["height"] = 11
				case "cometHash":
					result["cometHash"] = strings.Repeat("0", 64)
				case "committed":
					result["committed"] = false
				}
				result["transaction"] = tx
				_ = json.NewEncoder(w).Encode(result)
			}))
			defer gateway.Close()
			service, err := New(Config{RPCURL: gateway.URL, UpstreamMode: UpstreamBFT, FaucetKey: hex.EncodeToString(privateKey.Serialize()), FaucetAddress: faucetAddress, ChainID: 6423, DefaultAmount: 10, MaxAmount: 10, MaxRequests: 1, RequestLog: t.TempDir() + "/requests.jsonl"})
			if err != nil {
				t.Fatal(err)
			}
			_, status, err := service.Request(context.Background(), Request{Address: recipient}, "127.0.0.1:9000")
			if err == nil || status != http.StatusBadGateway {
				t.Fatalf("inconsistent %s response passed status=%d err=%v", field, status, err)
			}
		})
	}
}

func TestBFTFaucetRejectsUpstreamFailureAndUnsafeCustody(t *testing.T) {
	privateKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 41))
	faucetAddress, _ := consensus.NativeAddress(privateKey.PubKey().SerializeCompressed())
	recipient := nativeAddress(t, 42)
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode(chain.ConsensusAccount{Address: faucetAddress, Balance: 100})
			return
		}
		w.WriteHeader(http.StatusUnprocessableEntity)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid nonce"})
	}))
	defer gateway.Close()
	service, err := New(Config{RPCURL: gateway.URL, UpstreamMode: UpstreamBFT, FaucetKey: hex.EncodeToString(privateKey.Serialize()), FaucetAddress: faucetAddress, ChainID: 6423, DefaultAmount: 10, MaxAmount: 10, MaxRequests: 1, RequestLog: t.TempDir() + "/requests.jsonl"})
	if err != nil {
		t.Fatal(err)
	}
	if _, status, err := service.Request(context.Background(), Request{Address: recipient}, "127.0.0.1:9000"); err == nil || status != http.StatusBadGateway {
		t.Fatalf("upstream rejection passed status=%d err=%v", status, err)
	}
	insufficientGateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Error("insufficient balance request reached broadcast")
		}
		_ = json.NewEncoder(w).Encode(chain.ConsensusAccount{Address: faucetAddress, Balance: 10})
	}))
	defer insufficientGateway.Close()
	insufficientService, err := New(Config{RPCURL: insufficientGateway.URL, UpstreamMode: UpstreamBFT, FaucetKey: hex.EncodeToString(privateKey.Serialize()), FaucetAddress: faucetAddress, ChainID: 6423, DefaultAmount: 10, MaxAmount: 10, MaxRequests: 1, RequestLog: t.TempDir() + "/insufficient.jsonl"})
	if err != nil {
		t.Fatal(err)
	}
	if _, status, err := insufficientService.Request(context.Background(), Request{Address: recipient}, "127.0.0.2:9000"); err == nil || status != http.StatusBadGateway || !strings.Contains(err.Error(), "insufficient") {
		t.Fatalf("insufficient balance passed status=%d err=%v", status, err)
	}

	keyPath := t.TempDir() + "/faucet.key"
	if err := os.WriteFile(keyPath, privateKey.Serialize(), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := New(Config{RPCURL: gateway.URL, UpstreamMode: UpstreamBFT, FaucetKeyPath: keyPath, FaucetAddress: faucetAddress}); err == nil || !strings.Contains(err.Error(), "mode-restricted") {
		t.Fatalf("unsafe key permissions passed: %v", err)
	}
	if err := os.Chmod(keyPath, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(Config{RPCURL: gateway.URL, UpstreamMode: UpstreamBFT, FaucetKeyPath: keyPath, FaucetAddress: nativeAddress(t, 43)}); err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("custody mismatch passed: %v", err)
	}
	if _, err := New(Config{RPCURL: gateway.URL, UpstreamMode: UpstreamBFT, FaucetKeyPath: keyPath, FaucetAddress: faucetAddress}); err != nil {
		t.Fatalf("valid mode-restricted key file failed: %v", err)
	}
}

func TestFaucetServerRejectsOversizedAndUnknownBodies(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	rpc := httptest.NewServer(api.NewServer(devnet))
	defer rpc.Close()
	service, err := New(Config{RPCURL: rpc.URL, FaucetKey: "local-test-key", DefaultAmount: 25, MaxAmount: 25, MaxRequests: 1, RequestLog: t.TempDir() + "/requests.jsonl"})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()
	for _, body := range []string{`{"address":"ynx_valid","unknown":true}`, strings.Repeat("x", MaxRequestBodyBytes+1)} {
		resp, err := http.Post(server.URL+"/request", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("invalid body returned %d", resp.StatusCode)
		}
	}
}

func nativeAddress(t *testing.T, scalar byte) string {
	t.Helper()
	privateKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), scalar))
	address, err := consensus.NativeAddress(privateKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	return address
}
