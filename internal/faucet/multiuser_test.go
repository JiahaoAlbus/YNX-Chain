package faucet

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestCorePostTimeoutRecoversDurableReceiptWithoutResend(t *testing.T) {
	core, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	handler := api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var posts atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/faucet/requests" {
			posts.Add(1)
			handler.ServeHTTP(httptest.NewRecorder(), r)
			time.Sleep(250 * time.Millisecond)
			return
		}
		handler.ServeHTTP(w, r)
	}))
	defer upstream.Close()
	s := openTestFaucet(t, admissionTestConfig(t, upstream.URL))
	s.httpClient.Timeout = 100 * time.Millisecond
	address := "0x0000000000000000000000000000000000000043"
	receipt, status, err := s.Request(context.Background(), Request{Address: address, RequestID: admissionTestID}, "192.0.2.50:1000")
	if err != nil || status != 201 || receipt.Status != "accepted" {
		t.Fatalf("timeout recovery: %+v %d %v", receipt, status, err)
	}
	if posts.Load() != 1 {
		t.Fatalf("funding POST repeated %d times", posts.Load())
	}
	if account, _ := core.Account(address); account.Balance != 100 {
		t.Fatalf("balance %d", account.Balance)
	}
}

func TestLostCoreResponseRecoversOnlyExactDurableReceipt(t *testing.T) {
	for _, corruptReceipt := range []bool{false, true} {
		t.Run(fmt.Sprint("corrupt=", corruptReceipt), func(t *testing.T) {
			core, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			handler := api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
			var posts atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodPost && r.URL.Path == "/faucet/requests" {
					posts.Add(1)
					recorder := httptest.NewRecorder()
					handler.ServeHTTP(recorder, r)
					conn, _, err := w.(http.Hijacker).Hijack()
					if err != nil {
						t.Error(err)
						return
					}
					_ = conn.Close() // Core committed, but its HTTP acknowledgement was lost.
					return
				}
				if corruptReceipt && r.Method == http.MethodGet && r.URL.Path != "/health" {
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(map[string]any{"status": "durable", "transaction": map[string]any{"to": "0x0000000000000000000000000000000000000001"}})
					return
				}
				handler.ServeHTTP(w, r)
			}))
			defer upstream.Close()
			s := openTestFaucet(t, admissionTestConfig(t, upstream.URL))
			address := "0x0000000000000000000000000000000000000042"
			receipt, status, err := s.Request(context.Background(), Request{Address: address, RequestID: admissionTestID}, "192.0.2.50:1000")
			if corruptReceipt {
				if err == nil || status != 503 || receipt.Status != "transaction_result_uncertain" || !receipt.RetrySameRequest {
					t.Fatalf("unverified receipt accepted: %+v %d %v", receipt, status, err)
				}
			} else if err != nil || status != 201 || receipt.Status != "accepted" || receipt.TransactionHash != receipt.Transaction.Hash {
				t.Fatalf("durable receipt not recovered: %+v %d %v", receipt, status, err)
			}
			if posts.Load() != 1 {
				t.Fatalf("funding POST repeated %d times", posts.Load())
			}
			if account, _ := core.Account(address); account.Balance != 100 {
				t.Fatalf("balance %d", account.Balance)
			}
		})
	}
}

func TestMultiuserSameNATPersistentCore(t *testing.T) {
	for _, n := range []int{10, 50} {
		t.Run(fmt.Sprint(n), func(t *testing.T) {
			d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			core := httptest.NewServer(api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken}))
			defer core.Close()
			cfg := admissionTestConfig(t, core.URL)
			s := openTestFaucet(t, cfg)
			var wg sync.WaitGroup
			for i := 0; i < n; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					address := fmt.Sprintf("0x%040x", i+1)
					id := fmt.Sprintf("multiuser_%032d", i)
					r, status, err := s.Request(context.Background(), Request{Address: address, RequestID: id}, "192.0.2.50:1000")
					if err != nil || status != 201 || r.Address != address {
						t.Errorf("claim %d: status %d err %v", i, status, err)
					}
					if a, _ := d.Account(address); a.Balance != 100 {
						t.Errorf("claim %d balance %d", i, a.Balance)
					}
				}(i)
			}
			wg.Wait()
			// Address limits survive a change of network; neighbours can still claim.
			if _, status, _ := s.Request(context.Background(), Request{Address: fmt.Sprintf("0x%040x", 1), RequestID: "other_network_0123456789abcdef0123456789"}, "198.51.100.1:1000"); status != 429 {
				t.Fatalf("changed IP bypassed address quota: %d", status)
			}
			t.Logf("%d concurrent recipients on one NAT each credited 100 once", n)
		})
	}
}
func TestDurableStatusRecoversLostACKWithoutMint(t *testing.T) {
	d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	handler := api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var posts atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/faucet/requests" {
			posts.Add(1)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, r)
			http.Error(w, "lost ACK", 503)
			return
		}
		handler.ServeHTTP(w, r)
	}))
	defer core.Close()
	cfg := admissionTestConfig(t, core.URL)
	s := openTestFaucet(t, cfg)
	req := Request{Address: "ynx_status_recovery", RequestID: admissionTestID}
	if _, status, _ := s.Request(context.Background(), req, "192.0.2.1:80"); status != 503 {
		t.Fatal(status)
	}
	_ = s.Close()
	s = openTestFaucet(t, cfg)
	for i := 0; i < 2; i++ {
		r, status, err := s.RequestStatus(context.Background(), req.RequestID)
		if err != nil || status != 200 || r.Status != "accepted" || r.Transaction.Amount != 100 {
			t.Fatalf("status recovery %+v %d %v", r, status, err)
		}
	}
	if posts.Load() != 1 {
		t.Fatal("status query minted")
	}
	if a, _ := d.Account(req.Address); a.Balance != 100 {
		t.Fatal(a.Balance)
	}
	if _, status, _ := s.RequestStatus(context.Background(), "unknown_0123456789abcdef0123456789"); status != 404 {
		t.Fatal(status)
	}
}
func TestIndependentIPAbuseBudget(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	core := httptest.NewServer(api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken}))
	defer core.Close()
	cfg := admissionTestConfig(t, core.URL)
	cfg.IPMaxRequests = 2
	s := openTestFaucet(t, cfg)
	for i := 0; i < 3; i++ {
		_, status, _ := s.Request(context.Background(), Request{Address: fmt.Sprintf("ynx_ip_budget_%d", i), RequestID: fmt.Sprintf("ip_budget_%032d", i)}, "192.0.2.1:80")
		want := 201
		if i == 2 {
			want = 429
		}
		if status != want {
			t.Fatalf("IP budget %d status %d", i, status)
		}
	}
	if _, status, _ := s.Request(context.Background(), Request{Address: "ynx_ip_budget_2", RequestID: fmt.Sprintf("ip_budget_%032d", 2)}, "198.51.100.1:80"); status != 201 {
		t.Fatalf("denied attempt charged address: %d", status)
	}
}
