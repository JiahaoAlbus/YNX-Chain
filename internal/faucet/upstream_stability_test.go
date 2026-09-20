package faucet

import (
	"context"
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

func TestSameRequestConcurrencySendsOneCoreMutation(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	coreHandler := api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var capabilityCalls, mutations atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/evm":
			capabilityCalls.Add(1)
			time.Sleep(40 * time.Millisecond)
		case "/faucet/requests":
			mutations.Add(1)
			time.Sleep(80 * time.Millisecond)
		}
		coreHandler.ServeHTTP(w, r)
	}))
	defer core.Close()
	s := openTestFaucet(t, admissionTestConfig(t, core.URL))

	const callers = 32
	start := make(chan struct{})
	var wg sync.WaitGroup
	var failures atomic.Int32
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			resp, status, err := s.Request(context.Background(), Request{Address: "ynx_stability_same_id", RequestID: "stability_same_id_000000000000000000000"}, "192.0.2.1:80")
			if err != nil || (status != 200 && status != 201) || resp.Transaction.Amount != 100 {
				failures.Add(1)
			}
		}()
	}
	close(start)
	wg.Wait()
	if failures.Load() != 0 {
		t.Fatalf("%d callers failed", failures.Load())
	}
	if mutations.Load() != 1 {
		t.Fatalf("same request caused %d Core mutations, want 1", mutations.Load())
	}
	if capabilityCalls.Load() != 1 {
		t.Fatalf("same request caused %d capability probes, want 1", capabilityCalls.Load())
	}
	if account, _ := d.Account("ynx_stability_same_id"); account.Balance != 100 {
		t.Fatalf("balance %d, want 100", account.Balance)
	}
}

func TestDistinctUsersShareCapabilityProbeButFundConcurrently(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	coreHandler := api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var capabilityCalls, mutations, active, peak atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/evm" {
			capabilityCalls.Add(1)
			time.Sleep(50 * time.Millisecond)
		}
		if r.URL.Path == "/faucet/requests" {
			mutations.Add(1)
			n := active.Add(1)
			for p := peak.Load(); n > p && !peak.CompareAndSwap(p, n); p = peak.Load() {
			}
			defer active.Add(-1)
			time.Sleep(50 * time.Millisecond)
		}
		coreHandler.ServeHTTP(w, r)
	}))
	defer core.Close()
	s := openTestFaucet(t, admissionTestConfig(t, core.URL))

	const users = 16
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < users; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			address := fmt.Sprintf("0x%040x", 8000+i)
			id := fmt.Sprintf("stability_user_%032d", i)
			if _, status, err := s.Request(context.Background(), Request{Address: address, RequestID: id}, "192.0.2.55:80"); err != nil || status != 201 {
				t.Errorf("user %d: status=%d err=%v", i, status, err)
			}
		}()
	}
	close(start)
	wg.Wait()
	if capabilityCalls.Load() != 1 {
		t.Fatalf("%d users caused %d capability probes, want 1", users, capabilityCalls.Load())
	}
	if mutations.Load() != users {
		t.Fatalf("mutations=%d want=%d", mutations.Load(), users)
	}
	if peak.Load() < 2 {
		t.Fatalf("different users were serialized; peak upstream concurrency=%d", peak.Load())
	}
}

func TestConcurrentStatusRecoveryReadsCoreOnce(t *testing.T) {
	d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	coreHandler := api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var gets atomic.Int32
	var loseACK atomic.Bool
	loseACK.Store(true)
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/faucet/requests" && loseACK.CompareAndSwap(true, false) {
			recorder := httptest.NewRecorder()
			coreHandler.ServeHTTP(recorder, r)
			http.Error(w, "lost ACK", http.StatusServiceUnavailable)
			return
		}
		if r.Method == http.MethodGet && len(r.URL.Path) > len("/v1/native-transactions/") && r.URL.Path[:len("/v1/native-transactions/")] == "/v1/native-transactions/" {
			gets.Add(1)
			time.Sleep(80 * time.Millisecond)
		}
		coreHandler.ServeHTTP(w, r)
	}))
	defer core.Close()
	s := openTestFaucet(t, admissionTestConfig(t, core.URL))
	req := Request{Address: "ynx_stability_status", RequestID: "stability_status_0000000000000000000000"}
	if _, status, _ := s.Request(context.Background(), req, "192.0.2.1:80"); status != 503 {
		t.Fatalf("lost ACK status=%d", status)
	}

	const callers = 24
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			resp, status, err := s.RequestStatus(context.Background(), req.RequestID)
			if err != nil || status != 200 || resp.Status != "accepted" {
				t.Errorf("status=%d result=%s err=%v", status, resp.Status, err)
			}
		}()
	}
	close(start)
	wg.Wait()
	if gets.Load() != 1 {
		t.Fatalf("concurrent status recovery made %d Core reads, want 1", gets.Load())
	}
}

func TestCanceledCallerDoesNotCancelAdmittedFunding(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	coreHandler := api.NewServerWithConfig(d, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/faucet/requests" {
			once.Do(func() { close(started) })
			<-release
		}
		coreHandler.ServeHTTP(w, r)
	}))
	defer core.Close()
	s := openTestFaucet(t, admissionTestConfig(t, core.URL))
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _, _ = s.Request(ctx, Request{Address: "ynx_stability_cancel", RequestID: "stability_cancel_000000000000000000000"}, "192.0.2.1:80")
	}()
	<-started
	cancel()
	<-done
	close(release)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		resp, status, _ := s.RequestStatus(context.Background(), "stability_cancel_000000000000000000000")
		if status == 200 && resp.Status == "accepted" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("admitted funding did not finish after caller cancellation")
}
