package faucet

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

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
