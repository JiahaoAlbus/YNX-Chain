package faucet

import (
	"context"
	"fmt"
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

func TestHealthBoundedStagesAndRecovery(t *testing.T) {
	for _, stage := range []string{"status", "capability", "status-body"} {
		t.Run(stage, func(t *testing.T) {
			core := api.NewServerWithConfig(chain.NewDevnet(chain.DefaultNetworkConfig("testnet")), api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
			var stall atomic.Bool
			stall.Store(true)
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if stall.Load() && ((strings.HasPrefix(stage, "status") && r.URL.Path == "/status") || (stage == "capability" && r.URL.Path == "/evm")) {
					if stage == "status-body" {
						fmt.Fprint(w, `{"chainId":`)
						w.(http.Flusher).Flush()
					}
					select {
					case <-r.Context().Done():
					case <-time.After(time.Second):
					}
					return
				}
				core.ServeHTTP(w, r)
			}))
			defer up.Close()
			cfg := admissionTestConfig(t, up.URL)
			cfg.HealthTimeout = 80 * time.Millisecond
			s := openTestFaucet(t, cfg)
			started := time.Now()
			h := s.CheckHealth(context.Background())
			if h.OK || h.FundingReady || h.CheckedAt.IsZero() || h.ProbeDurationMS < 50 || time.Since(started) > time.Second || h.ProbeFailureStage != strings.TrimSuffix(stage, "-body") {
				t.Fatalf("unbounded or false readiness: %+v", h)
			}
			stall.Store(false)
			if h = s.CheckHealth(context.Background()); !h.FundingReady || h.LastError != "" {
				t.Fatalf("failed probe was cached: %+v", h)
			}
			metrics := s.Metrics()
			for _, want := range []string{
				"ynx_faucet_health_probes_total 2",
				"ynx_faucet_health_failures_total 1",
				"ynx_faucet_health_ready 1",
				"ynx_faucet_health_checked_timestamp_seconds ",
				"ynx_faucet_health_status_duration_seconds ",
				"ynx_faucet_health_capability_duration_seconds ",
				"ynx_faucet_admission_ready 1",
				"ynx_faucet_funding_ready 1",
				"ynx_faucet_funding_balance_applicable 0",
			} {
				if !strings.Contains(metrics, want) {
					t.Fatal(metrics)
				}
			}
		})
	}
}

func TestHealthAdmissionStoreFailureIsVisibleAndBlocksFundingReadiness(t *testing.T) {
	core := api.NewServerWithConfig(chain.NewDevnet(chain.DefaultNetworkConfig("testnet")), api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	up := httptest.NewServer(core)
	defer up.Close()
	s := openTestFaucet(t, admissionTestConfig(t, up.URL))
	if err := s.admissions.db.Close(); err != nil {
		t.Fatal(err)
	}
	h := s.CheckHealth(context.Background())
	if h.OK || h.FundingReady || h.AdmissionReady || h.ProbeFailureStage != "admission" {
		t.Fatalf("admission failure was not reflected in readiness: %+v", h)
	}
	metrics := s.Metrics()
	for _, want := range []string{
		"ynx_faucet_admission_ready 0",
		"ynx_faucet_funding_ready 0",
		`ynx_faucet_admission_store_errors_total{operation="health"} 1`,
	} {
		if !strings.Contains(metrics, want) {
			t.Fatalf("missing %q in metrics:\n%s", want, metrics)
		}
	}
}

func TestHealth48CallersCoalesceAndCanceledLeaderDoesNotPoison(t *testing.T) {
	core := api.NewServerWithConfig(chain.NewDevnet(chain.DefaultNetworkConfig("testnet")), api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	entered, release := make(chan struct{}, 1), make(chan struct{})
	var statuses, capabilities atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			statuses.Add(1)
			entered <- struct{}{}
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
		} else if r.URL.Path == "/evm" {
			capabilities.Add(1)
		}
		core.ServeHTTP(w, r)
	}))
	defer up.Close()
	s := openTestFaucet(t, admissionTestConfig(t, up.URL))
	ctx, cancel := context.WithCancel(context.Background())
	leader := make(chan Health, 1)
	go func() { leader <- s.CheckHealth(ctx) }()
	<-entered
	var wg sync.WaitGroup
	for i := 0; i < 48; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if h := s.CheckHealth(context.Background()); !h.FundingReady {
				t.Errorf("joined: %+v", h)
			}
		}()
	}
	deadline := time.Now().Add(time.Second)
	for {
		s.healthMu.Lock()
		joined := s.healthStats.joined
		s.healthMu.Unlock()
		if joined == 48 {
			break
		}
		if time.Now().After(deadline) {
			close(release)
			wg.Wait()
			t.Fatal("callers did not join")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	if h := <-leader; h.OK || h.ProbeFailureStage != "caller" {
		t.Fatal(h)
	}
	close(release)
	wg.Wait()
	if statuses.Load() != 1 || capabilities.Load() != 1 {
		t.Fatalf("probe stampede: %d %d", statuses.Load(), capabilities.Load())
	}
	// The next call must probe again, not serve an old successful snapshot.
	if h := s.CheckHealth(context.Background()); !h.FundingReady || statuses.Load() != 2 {
		t.Fatal(h)
	}
}

func TestHealthMonitorRefreshesWithoutPublicCallerAndStops(t *testing.T) {
	core := api.NewServerWithConfig(chain.NewDevnet(chain.DefaultNetworkConfig("testnet")), api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	up := httptest.NewServer(core)
	defer up.Close()
	s := openTestFaucet(t, admissionTestConfig(t, up.URL))
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		s.MonitorHealth(ctx, 5*time.Millisecond)
		close(done)
	}()
	deadline := time.Now().Add(time.Second)
	for {
		s.healthMu.Lock()
		probes := s.healthStats.probes
		checked := s.healthStats.last.CheckedAt
		s.healthMu.Unlock()
		if probes >= 2 && !checked.IsZero() {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("background health monitor did not refresh metrics")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("background health monitor did not stop")
	}
}

func TestPublicHealthUsesOnlyFreshBackgroundSnapshot(t *testing.T) {
	core := api.NewServerWithConfig(chain.NewDevnet(chain.DefaultNetworkConfig("testnet")), api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var stall atomic.Bool
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if stall.Load() {
			<-r.Context().Done()
			return
		}
		core.ServeHTTP(w, r)
	}))
	defer up.Close()
	cfg := admissionTestConfig(t, up.URL)
	cfg.HealthTimeout = 80 * time.Millisecond
	s := openTestFaucet(t, cfg)
	if h := s.CheckHealth(context.Background()); !h.FundingReady {
		t.Fatal(h)
	}
	stall.Store(true)
	started := time.Now()
	w := httptest.NewRecorder()
	NewServer(s).Handler().ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
	if w.Code != 200 || time.Since(started) > 30*time.Millisecond || !strings.Contains(w.Body.String(), `"probeCached":true`) {
		t.Fatalf("fresh snapshot was not served immediately: %d %s", w.Code, w.Body.String())
	}
	s.healthMu.Lock()
	s.healthStats.last.CheckedAt = time.Now().Add(-publicHealthFreshness - time.Second)
	s.healthMu.Unlock()
	started = time.Now()
	w = httptest.NewRecorder()
	NewServer(s).Handler().ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
	if w.Code != 502 || time.Since(started) < 50*time.Millisecond {
		t.Fatalf("stale success was served: %d %s", w.Code, w.Body.String())
	}
}

func TestHealthRejectsOversizedTrailingAndRedirectedStatus(t *testing.T) {
	for _, mode := range []string{"oversized", "trailing", "redirect", "wrong-chain", "error"} {
		t.Run(mode, func(t *testing.T) {
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch mode {
				case "oversized":
					fmt.Fprint(w, `{"padding":"`+strings.Repeat("x", MaxResponseBytes)+`"}`)
				case "trailing":
					fmt.Fprint(w, `{"chainId":6423,"nativeCurrencySymbol":"YNXT"} {}`)
				case "redirect":
					http.Redirect(w, r, "/other", 302)
				case "wrong-chain":
					fmt.Fprint(w, `{"chainId":1,"nativeCurrencySymbol":"YNXT"}`)
				default:
					http.Error(w, "unavailable", 503)
				}
			}))
			defer up.Close()
			s := openTestFaucet(t, admissionTestConfig(t, up.URL))
			w := httptest.NewRecorder()
			NewServer(s).Handler().ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
			if w.Code != 502 || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("unsafe response: %d %s", w.Code, w.Body)
			}
		})
	}
}

func TestHealthFailsBeforeAdmissionCapacityExhaustionBecomesInvisible(t *testing.T) {
	core := api.NewServerWithConfig(chain.NewDevnet(chain.DefaultNetworkConfig("testnet")), api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	up := httptest.NewServer(core)
	defer up.Close()
	cfg := admissionTestConfig(t, up.URL)
	cfg.MaxAdmissions = 2
	s := openTestFaucet(t, cfg)
	var first Request

	for i := 0; i < cfg.MaxAdmissions; i++ {
		req := Request{Address: fmt.Sprintf("0x%040x", i+1), RequestID: fmt.Sprintf("capacity_%032d", i)}
		if i == 0 {
			first = req
		}
		if _, status, err := s.Request(context.Background(), req, fmt.Sprintf("192.0.2.%d:80", i+1)); err != nil || status != http.StatusCreated {
			t.Fatalf("admission %d: status=%d err=%v", i, status, err)
		}
	}
	h := s.CheckHealth(context.Background())
	if h.OK || h.FundingReady || !h.AdmissionReady || h.AdmissionCapacityReady || h.ProbeFailureStage != "capacity" {
		t.Fatalf("capacity exhaustion remained ready: %+v", h)
	}
	if h.AdmissionCount != 2 || h.AdmissionCapacity != 2 || h.AdmissionRemaining != 0 || h.AdmissionScope != "single-instance-local-bbolt" || h.MultiActiveSupported || h.DeploymentStrategy != "stop-drain-start" {
		t.Fatalf("capacity or deployment truth missing: %+v", h)
	}
	w := httptest.NewRecorder()
	NewServer(s).Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/health", nil))
	if w.Code != http.StatusBadGateway {
		t.Fatalf("capacity-exhausted public health returned %d: %s", w.Code, w.Body.String())
	}
	if _, status, err := s.Request(context.Background(), first, "198.51.100.1:80"); err != nil || status != http.StatusOK {
		t.Fatalf("existing request did not remain replayable: status=%d err=%v", status, err)
	}
	newRequest := Request{Address: fmt.Sprintf("0x%040x", 3), RequestID: fmt.Sprintf("capacity_%032d", 3)}
	if _, status, err := s.Request(context.Background(), newRequest, "192.0.2.3:80"); err == nil || status != http.StatusServiceUnavailable {
		t.Fatalf("new request bypassed exhausted capacity: status=%d err=%v", status, err)
	}
	metrics := s.Metrics()
	for _, want := range []string{
		"ynx_faucet_admission_capacity_ready 0",
		"ynx_faucet_admission_count 2",
		"ynx_faucet_admission_capacity 2",
		"ynx_faucet_admission_remaining 0",
	} {
		if !strings.Contains(metrics, want) {
			t.Fatalf("missing %q in metrics:\n%s", want, metrics)
		}
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	cfg.MaxAdmissions = 3
	s = openTestFaucet(t, cfg)
	h = s.CheckHealth(context.Background())
	if !h.FundingReady || !h.AdmissionCapacityReady || h.AdmissionCount != 2 || h.AdmissionRemaining != 1 {
		t.Fatalf("capacity increase did not preserve and recover admissions: %+v", h)
	}
}

func TestHealthTimeoutConfigBounds(t *testing.T) {
	cfg := admissionTestConfig(t, "http://127.0.0.1:1")
	for _, timeout := range []time.Duration{-1, 6 * time.Second} {
		cfg.HealthTimeout = timeout
		if _, err := cfg.normalized(); err == nil {
			t.Fatal("unbounded timeout accepted")
		}
	}
}

func TestHealthTwoStagesShareOneDeadline(t *testing.T) {
	core := api.NewServerWithConfig(chain.NewDevnet(chain.DefaultNetworkConfig("testnet")), api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			time.Sleep(80 * time.Millisecond)
		}
		if r.URL.Path == "/evm" {
			time.Sleep(80 * time.Millisecond)
		}
		core.ServeHTTP(w, r)
	}))
	defer up.Close()
	cfg := admissionTestConfig(t, up.URL)
	cfg.HealthTimeout = 120 * time.Millisecond
	s := openTestFaucet(t, cfg)
	h := s.CheckHealth(context.Background())
	if h.FundingReady || h.ProbeFailureStage != "capability" || h.StatusDurationMS < 70 || h.CapabilityDurationMS < 20 || h.ProbeDurationMS > 300 {
		t.Fatalf("stages did not share a deadline: %+v", h)
	}
}
