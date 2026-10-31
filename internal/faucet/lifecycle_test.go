package faucet

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestFaucetCloseConcurrentEntryGateAndAdmittedChild(t *testing.T) {
	core := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	handler := api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	capEntered, capRelease := make(chan struct{}), make(chan struct{})
	postEntered, postRelease := make(chan struct{}), make(chan struct{})
	var capOnce, postOnce, capOpen, postOpen sync.Once
	var posts, upstreamCalls atomic.Int32
	releaseCap := func() { capOpen.Do(func() { close(capRelease) }) }
	releasePost := func() { postOpen.Do(func() { close(postRelease) }) }
	defer releaseCap()
	defer releasePost()
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalls.Add(1)
		if r.URL.Path == "/evm" {
			capOnce.Do(func() { close(capEntered) })
			<-capRelease
		}
		if r.URL.Path == "/faucet/requests" {
			posts.Add(1)
			postOnce.Do(func() { close(postEntered) })
			<-postRelease
		}
		handler.ServeHTTP(w, r)
	}))
	defer up.Close()
	cfg := admissionTestConfig(t, up.URL)
	s := openTestFaucet(t, cfg)
	req := Request{Address: "ynx_close_accepted", RequestID: admissionTestID}
	requestDone := make(chan struct{})
	var result Response
	var code int
	var requestErr error
	go func() {
		defer close(requestDone)
		result, code, requestErr = s.Request(context.Background(), req, "192.0.2.1")
	}()
	defer func() {
		releaseCap()
		releasePost()
		select {
		case <-requestDone:
		case <-time.After(3 * time.Second):
			t.Error("accepted request failed to drain")
		}
	}()
	select {
	case <-capEntered:
	case <-time.After(3 * time.Second):
		t.Fatal("actual accepted parent did not enter capability")
	}
	const closers = 32
	closed := make(chan error, closers)
	for i := 0; i < closers; i++ {
		go func() { closed <- s.Close() }()
	}
	select {
	case <-s.stopSignal():
	case <-time.After(time.Second):
		t.Fatal("Close did not seal admission")
	}
	before := upstreamCalls.Load()
	var entries sync.WaitGroup
	for i := 0; i < 32; i++ {
		entries.Add(1)
		go func() {
			defer entries.Done()
			resp, status, err := s.Request(context.Background(), req, "192.0.2.2")
			if status != 503 || err != errServiceClosed || resp.RequestID != req.RequestID || !resp.RetrySameRequest {
				t.Error("closing Request lost original ID or bypassed the gate", resp, status, err)
			}
			resp, status, err = s.RequestStatus(context.Background(), req.RequestID)
			if status != 503 || err != errServiceClosed || resp.RequestID != req.RequestID || !resp.RetrySameRequest {
				t.Error("closing status bypassed the gate", resp, status, err)
			}
			if h := s.CheckHealth(context.Background()); h.OK || h.FundingReady || h.ProbeFailureStage != "lifecycle" {
				t.Error("closing health claimed availability", h)
			}
			if _, fresh := s.RecentHealth(time.Hour); fresh {
				t.Error("closing service served a stale successful health snapshot")
			}
		}()
	}
	entries.Wait()
	if upstreamCalls.Load() != before {
		t.Fatal("closed public entry started another upstream operation")
	}
	// The parent entered before Close. Its new funding child must be retained
	// even though the public gate is now sealed, without Add/Wait reaching zero.
	releaseCap()
	select {
	case <-postEntered:
	case <-time.After(3 * time.Second):
		t.Fatal("accepted parent lost its funding operation during Close")
	}
	select {
	case err := <-closed:
		t.Fatal("concurrent Close escaped before accepted child", err)
	default:
	}
	releasePost()
	select {
	case <-requestDone:
	case <-time.After(3 * time.Second):
		t.Fatal("accepted request did not finish")
	}
	if requestErr != nil || code != 201 || result.Transaction.Amount != 100 || posts.Load() != 1 {
		t.Fatal("shutdown changed the accepted operation", result, code, requestErr, posts.Load())
	}
	for i := 0; i < closers; i++ {
		select {
		case err := <-closed:
			if err != nil {
				t.Fatal("concurrent Close did not share the successful result", err)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("concurrent Close did not terminate")
		}
	}
	if err := s.Close(); err != nil {
		t.Fatal("Close is not idempotent", err)
	}
	reopened := openTestFaucet(t, cfg)
	if _, status, err := reopened.RequestStatus(context.Background(), req.RequestID); status != 200 || err != nil || posts.Load() != 1 {
		t.Fatal("accepted child was not persisted before releasing database ownership", status, err)
	}
}

func TestFaucetCloseStopsHealthMonitorAndPreservesNoDatabaseClose(t *testing.T) {
	var absent *Service
	if err := absent.Close(); err != nil {
		t.Fatal(err)
	}
	var noDatabase Service
	if err := noDatabase.Close(); err != nil {
		t.Fatal(err)
	}
	if err := noDatabase.Close(); err != nil {
		t.Fatal("no-database Close is not idempotent", err)
	}
	core := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	handler := api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	entered, release := make(chan struct{}), make(chan struct{})
	var enteredOnce, releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			enteredOnce.Do(func() { close(entered) })
			<-release
		}
		handler.ServeHTTP(w, r)
	}))
	defer up.Close()
	s := openTestFaucet(t, admissionTestConfig(t, up.URL))
	monitor := make(chan struct{})
	go func() { defer close(monitor); s.MonitorHealth(context.Background(), time.Hour) }()
	defer unblock()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("actual monitor did not enter the original probe")
	}
	closed := make(chan error, 1)
	go func() { closed <- s.Close() }()
	<-s.stopSignal()
	unblock()
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Close did not drain the monitor and health worker")
	}
	select {
	case <-monitor:
	case <-time.After(time.Second):
		t.Fatal("monitor waited for its hour-long scheduler after Close")
	}
}

// Exercise the actual public entry points, detached HTTP workers and durable
// admission store. The caller disconnects while the real Core operation is
// deliberately blocked; Close must not close its database underneath it.
func TestFaucetCloseWaitsForDetachedWorkers(t *testing.T) {
	for _, kind := range []string{"funding", "unknown-funding", "status", "capability", "health"} {
		t.Run(kind, func(t *testing.T) {
			core, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			handler := api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
			entered, release := make(chan struct{}), make(chan struct{})
			var releaseOnce, enteredOnce sync.Once
			unblock := func() { releaseOnce.Do(func() { close(release) }) }
			defer unblock()
			var block, hideReceipt atomic.Bool
			var posts atomic.Int32
			hideReceipt.Store(kind == "status" || kind == "unknown-funding")
			block.Store(kind != "status")
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				isPost := r.URL.Path == "/faucet/requests"
				isReceipt := strings.HasPrefix(r.URL.Path, "/v1/native-transactions/")
				if isPost {
					posts.Add(1)
					// Commit the real mutation once, then lose its HTTP response.
					handler.ServeHTTP(httptest.NewRecorder(), r)
				}
				shouldBlock := block.Load() && ((strings.Contains(kind, "funding") && isPost) || kind == "status" && isReceipt || kind == "capability" && r.URL.Path == "/evm" || kind == "health" && r.URL.Path == "/status")
				if shouldBlock {
					enteredOnce.Do(func() { close(entered) })
					<-release
				}
				if isPost {
					http.Error(w, "lost actual Core ACK", http.StatusServiceUnavailable)
					return
				}
				if isReceipt && hideReceipt.Load() {
					http.NotFound(w, r)
					return
				}
				handler.ServeHTTP(w, r)
			}))
			defer up.Close()
			cfg := admissionTestConfig(t, up.URL)
			s := openTestFaucet(t, cfg)
			req := Request{Address: "ynx_close_recipient", RequestID: admissionTestID}
			if kind == "status" {
				if result, code, err := s.Request(context.Background(), req, "192.0.2.1"); err == nil || code != 503 || !result.RetrySameRequest {
					t.Fatal("normal lost-ACK setup did not preserve UNKNOWN", result, code, err)
				}
				hideReceipt.Store(false)
				block.Store(true)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			callerDone := make(chan struct{})
			go func() {
				defer close(callerDone)
				switch kind {
				case "health":
					_ = s.CheckHealth(ctx)
				case "status":
					_, _, _ = s.RequestStatus(ctx, req.RequestID)
				default:
					_, _, _ = s.Request(ctx, req, "192.0.2.1")
				}
			}()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("normal upstream worker did not enter")
			}
			var workerDone <-chan struct{}
			if kind == "health" {
				s.healthMu.Lock()
				workerDone = s.healthFlight.done
				s.healthMu.Unlock()
			} else {
				s.flightMu.Lock()
				switch kind {
				case "capability":
					workerDone = s.capabilityFlight.done
				case "status":
					workerDone = s.statusFlights[req.RequestID].done
				default:
					workerDone = s.fundingFlights[req.RequestID].done
				}
				s.flightMu.Unlock()
			}
			// Even a failed assertion must release and join the actual HTTP worker
			// before testing removes its source files; no orphan is hidden.
			defer func() {
				unblock()
				select {
				case <-workerDone:
				case <-time.After(3 * time.Second):
					t.Error("actual detached worker did not finish")
				}
			}()
			cancel()
			select {
			case <-callerDone:
			case <-time.After(time.Second):
				t.Fatal("canceled caller waited for the detached worker")
			}
			closed := make(chan error, 1)
			go func() { closed <- s.Close() }()
			select {
			case err := <-closed:
				t.Fatalf("FAUCET_CLOSE_WORKER_NOT_JOINED: Close returned while %s worker was blocked: %v", kind, err)
			case <-time.After(50 * time.Millisecond):
			}
			unblock()
			select {
			case err := <-closed:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("Close did not join the released bounded worker")
			}
			if strings.Contains(kind, "funding") || kind == "status" {
				reopened := openTestFaucet(t, cfg)
				if kind == "unknown-funding" {
					result, code, err := reopened.RequestStatus(context.Background(), req.RequestID)
					if err != nil || code != 202 || !result.RetrySameRequest || result.Status != "pending" {
						t.Fatal("Close erased or fabricated the UNKNOWN intent", result, code, err)
					}
					other := req
					other.RequestID = "other_0123456789abcdef0123456789abcdef"
					if _, code, _ := reopened.Request(context.Background(), other, "192.0.2.1"); code != 429 {
						t.Fatal("Close reset the original quota", code)
					}
					hideReceipt.Store(false)
				}
				result, code, err := reopened.RequestStatus(context.Background(), req.RequestID)
				if err != nil || code != 200 || result.Status != "accepted" || result.Transaction.Amount != 100 {
					t.Fatal("Close lost the actual durable Core receipt", result, code, err)
				}
				if posts.Load() != 1 {
					t.Fatal("Close/recovery replayed a funding POST", posts.Load())
				}
				if account, _ := core.Account(req.Address); account.Balance != 100 {
					t.Fatal("Close/recovery changed real Core funding", account)
				}
			}
		})
	}
}
