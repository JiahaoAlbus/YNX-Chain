package faucet

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const admissionTestID = "req_0123456789abcdef0123456789abcdef"

func admissionTestConfig(t *testing.T, url string) Config {
	t.Helper()
	return Config{CoreAuthTokenPath: testCoreTokenFile(t), RPCURL: url, FaucetKey: "local-fixture-only", RequestLog: filepath.Join(t.TempDir(), "requests.jsonl"), DefaultAmount: 100, MaxAmount: 101, MaxRequests: 1, Window: time.Hour, ChainID: 6423}
}

func openTestFaucet(t *testing.T, cfg Config) *Service {
	t.Helper()
	s, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestDurableFaucetLostACKAndColdReplayChargeOnce(t *testing.T) {
	d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	core := api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var posts atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/faucet/requests" && posts.Add(1) == 1 {
			out := httptest.NewRecorder()
			core.ServeHTTP(out, r)
			if out.Code != 201 {
				t.Errorf("core rejected fixture: %d", out.Code)
			}
			http.Error(w, "acknowledgement lost", 503)
			return
		}
		core.ServeHTTP(w, r)
	}))
	defer upstream.Close()
	cfg := admissionTestConfig(t, upstream.URL)
	s := openTestFaucet(t, cfg)
	req := Request{Address: "ynx_admission_retry", RequestID: admissionTestID}
	first, status, err := s.Request(context.Background(), req, "192.0.2.1:80")
	hash, _ := chain.FaucetRequestHash(6423, admissionTestID)
	if err == nil || status != 503 || first.RequestID != admissionTestID || first.TransactionHash != hash || !first.RetrySameRequest {
		t.Fatalf("lost retry identity: %+v %d %v", first, status, err)
	}
	if a, _ := d.Account(req.Address); a.Balance != 100 {
		t.Fatalf("original call was not accepted: %+v", a)
	}
	changed := req
	changed.Amount = 101
	if _, status, err := s.Request(context.Background(), changed, "192.0.2.1:80"); err == nil || status != 409 {
		t.Fatalf("changed payload accepted: %d %v", status, err)
	}
	other := req
	other.RequestID = "other_0123456789abcdef0123456789abcdef"
	if _, status, err := s.Request(context.Background(), other, "192.0.2.1:80"); err == nil || status != 429 {
		t.Fatalf("second quota admitted: %d %v", status, err)
	}
	second, status, err := s.Request(context.Background(), req, "198.51.100.2:99")
	if err != nil || status != 200 || second.Transaction.Hash != hash || !second.Replayed {
		t.Fatalf("exact replay: %+v %d %v", second, status, err)
	}
	_ = s.Close()
	s = openTestFaucet(t, cfg)
	third, status, err := s.Request(context.Background(), req, "198.51.100.3:99")
	if err != nil || status != 200 || third.Transaction.Hash != hash || posts.Load() != 2 {
		t.Fatalf("cold cached replay: %+v %d %v posts=%d", third, status, err, posts.Load())
	}
	if a, _ := d.Account(req.Address); a.Balance != 100 {
		t.Fatal("retry credited more than once")
	}
	if _, status, _ := s.Request(context.Background(), other, "192.0.2.1:80"); status != 429 {
		t.Fatal("restart forgot admission quota")
	}
}

func TestDurableFaucetConcurrentRetriesAndCapacity(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	upstream := httptest.NewServer(api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken}))
	defer upstream.Close()
	cfg := admissionTestConfig(t, upstream.URL)
	cfg.MaxAdmissions = 1
	s := openTestFaucet(t, cfg)
	var wg sync.WaitGroup
	for n := 0; n < 16; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, status, err := s.Request(context.Background(), Request{Address: "ynx_concurrent_admission", RequestID: admissionTestID}, "192.0.2.1:80")
			if err != nil || status != 200 && status != 201 || resp.Transaction.Hash == "" {
				t.Errorf("concurrent request: %d %v", status, err)
			}
		}()
	}
	wg.Wait()
	if a, _ := d.Account("ynx_concurrent_admission"); a.Balance != 100 {
		t.Fatal("concurrent duplicate credit")
	}
	if _, status, _ := s.Request(context.Background(), Request{Address: "ynx_different_admission", RequestID: "next_0123456789abcdef0123456789abcdef"}, "198.51.100.1"); status != 503 {
		t.Fatalf("capacity not enforced: %d", status)
	}
	if _, status, err := s.Request(context.Background(), Request{Address: "ynx_concurrent_admission", RequestID: admissionTestID}, "192.0.2.1"); status != 200 || err != nil {
		t.Fatalf("capacity blocked existing ID: %d %v", status, err)
	}
}

func TestDurableFaucetReceiptStoreFailureRetainsOriginalAdmission(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	core := api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var s *Service
	var closeOnce sync.Once
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		core.ServeHTTP(w, r)
		if r.URL.Path == "/faucet/requests" {
			closeOnce.Do(func() { _ = s.Close() })
		}
	}))
	defer upstream.Close()
	cfg := admissionTestConfig(t, upstream.URL)
	s = openTestFaucet(t, cfg)
	req := Request{Address: "ynx_local_receipt_failure", RequestID: admissionTestID}
	resp, status, err := s.Request(context.Background(), req, "192.0.2.1")
	if err == nil || status != 503 || resp.Status != "receipt_persistence_uncertain" || !resp.RetrySameRequest {
		t.Fatalf("receipt failure: %+v %d %v", resp, status, err)
	}
	s = openTestFaucet(t, cfg)
	resp, status, err = s.Request(context.Background(), req, "192.0.2.1")
	if err != nil || status != 200 || !resp.Replayed {
		t.Fatalf("receipt recovery: %+v %d %v", resp, status, err)
	}
	if a, _ := d.Account(req.Address); a.Balance != 100 {
		t.Fatal("receipt loss credited twice")
	}
}

func TestDurableFaucetUnavailableStoreNeverCallsMutation(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	core := api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var posts atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/faucet/requests" {
			posts.Add(1)
		}
		core.ServeHTTP(w, r)
	}))
	defer upstream.Close()
	cfg := admissionTestConfig(t, upstream.URL)
	s := openTestFaucet(t, cfg)
	_ = s.Close()
	if _, status, err := s.Request(context.Background(), Request{Address: "ynx_unwritten_admission", RequestID: admissionTestID}, "192.0.2.1"); err == nil || status != 503 || posts.Load() != 0 {
		t.Fatalf("mutation before admission: %d %v", status, err)
	}
	if err := os.Truncate(cfg.RequestLog+".admissions.db", 0); err != nil {
		t.Fatal(err)
	}
	if _, err := New(cfg); err == nil {
		t.Fatal("truncated registry silently reset")
	}
}

func TestDurableFaucetOldRouteAndRedirectFailClosed(t *testing.T) {
	for _, redirect := range []bool{false, true} {
		t.Run(fmt.Sprint(redirect), func(t *testing.T) {
			d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
			core := api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
			var legacy atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/faucet" {
					legacy.Add(1)
					core.ServeHTTP(w, r)
					return
				}
				if r.URL.Path == "/faucet/requests" {
					if redirect {
						http.Redirect(w, r, "/faucet", 307)
					} else {
						http.NotFound(w, r)
					}
					return
				}
				core.ServeHTTP(w, r)
			}))
			defer upstream.Close()
			s := openTestFaucet(t, admissionTestConfig(t, upstream.URL))
			for n := 0; n < 2; n++ {
				resp, status, err := s.Request(context.Background(), Request{Address: "ynx_old_upstream", RequestID: admissionTestID}, "192.0.2.1")
				if err == nil || status != 503 || !resp.RetrySameRequest {
					t.Fatalf("unsafe route accepted: %d %v", status, err)
				}
			}
			if legacy.Load() != 0 {
				t.Fatal("fell back or redirected to legacy mutation")
			}
			if a, _ := d.Account("ynx_old_upstream"); a.Balance != 0 {
				t.Fatal("old route minted")
			}
		})
	}
}

func TestDurableFaucetRejectsForgedReceiptAndExposesRetryIdentity(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	core := api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/faucet/requests" {
			core.ServeHTTP(w, r)
			return
		}
		w.Header().Set("X-YNX-Faucet-Idempotency", chain.FaucetRequestVersion)
		_ = json.NewEncoder(w).Encode(chain.Transaction{Hash: "0xwrong", Amount: 100})
	}))
	defer upstream.Close()
	s := openTestFaucet(t, admissionTestConfig(t, upstream.URL))
	server := NewServer(s).Handler()
	w := httptest.NewRecorder()
	server.ServeHTTP(w, httptest.NewRequest("POST", "/request", strings.NewReader(`{"address":"ynx_forged_receipt","requestId":"`+admissionTestID+`"}`)))
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if w.Code != 503 || out["requestId"] != admissionTestID || out["retrySameRequest"] != true || out["transactionHash"] == "" || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("lost safe retry metadata: %d %v", w.Code, out)
	}
}

func TestDurableFaucetImportsLegacyQuotaAndRejectsCorruptLog(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	upstream := httptest.NewServer(api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken}))
	defer upstream.Close()
	cfg := admissionTestConfig(t, upstream.URL)
	entry, _ := json.Marshal(LogEntry{RequestID: "legacy", Status: "sent", Address: "ynx_prior_recipient", IP: "192.0.2.1", Amount: 100, At: time.Now()})
	if err := os.WriteFile(cfg.RequestLog, append(entry, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	s := openTestFaucet(t, cfg)
	if _, status, _ := s.Request(context.Background(), Request{Address: "ynx_prior_recipient", RequestID: admissionTestID}, "192.0.2.1"); status != 429 {
		t.Fatalf("legacy quota forgotten: %d", status)
	}
	cfg = admissionTestConfig(t, upstream.URL)
	if err := os.WriteFile(cfg.RequestLog, []byte("{truncated"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(cfg); err == nil {
		t.Fatal("corrupt prior log ignored")
	}
}

func TestDurableCoreRouteRequiresRequestID(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	core := api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	w := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/faucet/requests", strings.NewReader(`{"address":"ynx_missing_request","amount":100}`))
	request.Header.Set("X-YNX-Faucet-Auth", faucetTestCoreToken)
	core.ServeHTTP(w, request)
	if w.Code != 400 {
		t.Fatalf("missing ID accepted: %d", w.Code)
	}
	if a, _ := d.Account("ynx_missing_request"); a.Balance != 0 {
		t.Fatal("missing ID mutated chain")
	}
}

func TestDurableFaucetRetryRetainsAdmittedAmountAcrossConfigChange(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	core := api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var posts atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/faucet/requests" && posts.Add(1) == 1 {
			core.ServeHTTP(httptest.NewRecorder(), r)
			http.Error(w, "ack lost", 503)
			return
		}
		core.ServeHTTP(w, r)
	}))
	defer upstream.Close()
	cfg := admissionTestConfig(t, upstream.URL)
	s := openTestFaucet(t, cfg)
	req := Request{Address: "ynx_default_change", RequestID: admissionTestID}
	if _, status, err := s.Request(context.Background(), req, "192.0.2.1"); status != 503 || err == nil {
		t.Fatalf("expected lost ACK: %d %v", status, err)
	}
	_ = s.Close()
	cfg.DefaultAmount = 50
	cfg.MaxAmount = 50
	s = openTestFaucet(t, cfg)
	response, status, err := s.Request(context.Background(), req, "192.0.2.1")
	if err != nil || status != 200 || response.Amount != 100 || response.Transaction.Amount != 100 {
		t.Fatalf("default changed existing intent: %+v %d %v", response, status, err)
	}
	if a, _ := d.Account(req.Address); a.Balance != 100 {
		t.Fatal("configuration change created new credit")
	}
	changed := req
	changed.Amount = 50
	if _, status, _ := s.Request(context.Background(), changed, "192.0.2.1"); status != 409 {
		t.Fatal("explicitly changed amount accepted")
	}
}

func TestDurableFaucetManyIndependentUsers(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	upstream := httptest.NewServer(api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken}))
	defer upstream.Close()
	s := openTestFaucet(t, admissionTestConfig(t, upstream.URL))
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			address := fmt.Sprintf("ynx_parallel_user_%02d", n)
			id := fmt.Sprintf("parallel_0123456789abcdef0123456789_%02d", n)
			_, status, err := s.Request(context.Background(), Request{Address: address, RequestID: id}, fmt.Sprintf("192.0.2.%d", n+1))
			if err != nil || status != 201 {
				t.Errorf("independent user %d: %d %v", n, status, err)
			}
		}(i)
	}
	wg.Wait()
	for i := 0; i < 32; i++ {
		if a, _ := d.Account(fmt.Sprintf("ynx_parallel_user_%02d", i)); a.Balance != 100 {
			t.Fatalf("user %d balance=%d", i, a.Balance)
		}
	}
}
