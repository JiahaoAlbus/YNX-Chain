package faucet

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const operatorTestID = "operator_0123456789abcdef0123456789abcdef"
const operatorTestAddress = "0x00000000000000000000000000000000000000b1"

func exhaustedOperatorFixture(t *testing.T, url string) Config {
	t.Helper()
	cfg := admissionTestConfig(t, url)
	s, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	record, _, err := s.admissions.admit(operatorTestID, operatorTestAddress, "192.0.2.88", 100, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.admissions.enableAsync(record); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < maxAsyncFundingAttempts-1; i++ {
		if started, err := s.admissions.beginAsyncRetry(operatorTestID, maxAsyncFundingAttempts); err != nil || !started {
			t.Fatalf("exhaust fixture %v %v", started, err)
		}
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	return s.cfg
}

func TestOperatorRecoveryDryRunAndOneShot(t *testing.T) {
	core := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	handler := api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var posts atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/faucet/requests" {
			posts.Add(1)
		}
		handler.ServeHTTP(w, r)
	}))
	defer up.Close()
	cfg := exhaustedOperatorFixture(t, up.URL)
	before, err := os.ReadFile(cfg.AdmissionPath)
	if err != nil {
		t.Fatal(err)
	}
	result, err := InspectOrRecoverRequest(context.Background(), cfg, operatorTestID, operatorTestAddress, 100, false)
	if err != nil || result.Status != "eligible_receipt_absent" || result.Executed {
		t.Fatalf("dry run: %+v %v", result, err)
	}
	after, err := os.ReadFile(cfg.AdmissionPath)
	if err != nil || sha256.Sum256(before) != sha256.Sum256(after) || posts.Load() != 0 {
		t.Fatal("dry run changed admission or sent Core POST", err)
	}
	if result, err = InspectOrRecoverRequest(context.Background(), cfg, operatorTestID, operatorTestAddress, 101, true); err == nil || result.Status != "binding_mismatch" || posts.Load() != 0 {
		t.Fatalf("wrong binding: %+v %v", result, err)
	}
	result, err = InspectOrRecoverRequest(context.Background(), cfg, operatorTestID, operatorTestAddress, 100, true)
	if err != nil || result.Status != "completed" || result.RecoveryOutcome != "confirmed" || !result.Executed || posts.Load() != 1 {
		t.Fatalf("execute: %+v %v posts=%d", result, err, posts.Load())
	}
	result, err = InspectOrRecoverRequest(context.Background(), cfg, operatorTestID, operatorTestAddress, 100, true)
	if err != nil || result.Status != "completed" || result.Executed || posts.Load() != 1 {
		t.Fatalf("replay: %+v %v posts=%d", result, err, posts.Load())
	}
	if account, _ := core.Account(operatorTestAddress); account.Balance != 100 {
		t.Fatalf("expected one credit, got %d", account.Balance)
	}
}

func TestOperatorRecoveryUnknownResultNeverResends(t *testing.T) {
	core, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	handler := api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var posts atomic.Int32
	var readAvailable atomic.Bool
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/faucet/requests" {
			posts.Add(1)
			handler.ServeHTTP(httptest.NewRecorder(), r)
			http.Error(w, "ack lost", 503)
			return
		}
		if r.Method == http.MethodGet && !readAvailable.Load() {
			http.Error(w, "read unavailable", 503)
			return
		}
		handler.ServeHTTP(w, r)
	}))
	defer up.Close()
	cfg := exhaustedOperatorFixture(t, up.URL)
	// The receipt path must be healthy before the one-shot write is authorized.
	readAvailable.Store(true)
	result, err := InspectOrRecoverRequest(context.Background(), cfg, operatorTestID, operatorTestAddress, 100, true)
	if err != nil || result.Status != "completed" || result.RecoveryOutcome != "confirmed_after_uncertain_ack" || posts.Load() != 1 {
		t.Fatalf("lost ack recovery: %+v %v posts=%d", result, err, posts.Load())
	}
	// Simulate process termination after the durable reservation and before
	// a response: a fresh invocation can only read, never issue another POST.
	result, err = InspectOrRecoverRequest(context.Background(), cfg, operatorTestID, operatorTestAddress, 100, true)
	if err != nil || result.Status != "completed" || posts.Load() != 1 {
		t.Fatalf("restart replay: %+v %v posts=%d", result, err, posts.Load())
	}
}

func TestOperatorRecoveryNonDurableReceiptCannotAuthorizePost(t *testing.T) {
	var posts atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts.Add(1)
			http.Error(w, "unexpected mutation", 500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"schemaVersion":"ynx-native-finance-transaction-v1","integerEncoding":"decimal-string","status":"pending","durability":{"version":"ynx-local-durability-v1","scope":"local-snapshot"}}`))
	}))
	defer up.Close()
	cfg := exhaustedOperatorFixture(t, up.URL)
	result, err := InspectOrRecoverRequest(context.Background(), cfg, operatorTestID, operatorTestAddress, 100, true)
	if err != nil || result.Status != "receipt_not_durable" || posts.Load() != 0 {
		t.Fatalf("non-durable receipt must not authorize POST: %+v %v posts=%d", result, err, posts.Load())
	}
	db, err := openAdmissionStore(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer db.db.Close()
	record, _, err := db.lookup(operatorTestID)
	if err != nil || record.OperatorRecovery != nil {
		t.Fatalf("non-durable receipt reserved attempt: %+v %v", record, err)
	}
}

func TestOperatorRecoveryProcessCrashReservationAndDBFence(t *testing.T) {
	if os.Getenv("YNX_OPERATOR_CRASH_CHILD") == "1" {
		var cfg Config
		if err := json.Unmarshal([]byte(os.Getenv("YNX_OPERATOR_CONFIG")), &cfg); err != nil {
			t.Fatal(err)
		}
		db, err := openAdmissionStore(cfg)
		if err != nil {
			t.Fatal(err)
		}
		record, _, err := db.lookup(operatorTestID)
		if err != nil {
			t.Fatal(err)
		}
		if reserved, err := db.reserveOperatorRecovery(record); err != nil || !reserved {
			t.Fatalf("reserve: %v %v", reserved, err)
		}
		os.Exit(0) // crash before any network call or clean DB close
	}
	core := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	handler := api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var posts atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/faucet/requests" {
			posts.Add(1)
		}
		handler.ServeHTTP(w, r)
	}))
	defer up.Close()
	cfg := exhaustedOperatorFixture(t, up.URL)
	// A running daemon's DB lock fences the offline operator.
	db, err := openAdmissionStore(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := InspectOrRecoverRequest(context.Background(), cfg, operatorTestID, operatorTestAddress, 100, true); err == nil {
		t.Fatal("operator bypassed live DB lock")
	}
	if err := db.db.Close(); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(cfg)
	cmd := exec.Command(os.Args[0], "-test.run=^TestOperatorRecoveryProcessCrashReservationAndDBFence$")
	cmd.Env = append(os.Environ(), "YNX_OPERATOR_CRASH_CHILD=1", "YNX_OPERATOR_CONFIG="+string(raw))
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("crash child: %v %s", err, output)
	}
	result, err := InspectOrRecoverRequest(context.Background(), cfg, operatorTestID, operatorTestAddress, 100, true)
	if err != nil || result.Status != "recovery_result_unknown" || posts.Load() != 0 {
		t.Fatalf("crash recovery attempted second POST: %+v %v posts=%d", result, err, posts.Load())
	}
}

func TestOperatorRecoveryReceiptPersistenceFailureKeepsReservation(t *testing.T) {
	core, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	handler := api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var posts atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/faucet/requests" {
			posts.Add(1)
		}
		handler.ServeHTTP(w, r)
	}))
	defer up.Close()
	cfg := exhaustedOperatorFixture(t, up.URL)
	result, err := inspectOrRecoverRequest(context.Background(), cfg, operatorTestID, operatorTestAddress, 100, true,
		func(*admissionStore, admissionRecord, chain.Transaction) error {
			return errors.New("injected durable receipt write failure")
		})
	if err == nil || result.Status != "receipt_persistence_failed" || !result.Executed || posts.Load() != 1 {
		t.Fatalf("persistence failure: %+v %v posts=%d", result, err, posts.Load())
	}
	// A fresh process invocation reconciles the Core receipt but cannot POST.
	result, err = InspectOrRecoverRequest(context.Background(), cfg, operatorTestID, operatorTestAddress, 100, true)
	if err != nil || result.Status != "durable_receipt_found" || result.Executed || posts.Load() != 1 {
		t.Fatalf("reconciliation: %+v %v posts=%d", result, err, posts.Load())
	}
	result, err = InspectOrRecoverRequest(context.Background(), cfg, operatorTestID, operatorTestAddress, 100, false)
	if err != nil || result.Status != "completed" || result.RecoveryOutcome != "confirmed_on_reconcile" || posts.Load() != 1 {
		t.Fatalf("durable marker: %+v %v posts=%d", result, err, posts.Load())
	}
}

func TestOperatorRecoveryCoreFailureRemainsOneShot(t *testing.T) {
	core := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	handler := api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var posts atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/faucet/requests" {
			posts.Add(1)
			http.Error(w, "core outage", 503)
			return
		}
		handler.ServeHTTP(w, r)
	}))
	defer up.Close()
	cfg := exhaustedOperatorFixture(t, up.URL)
	result, err := InspectOrRecoverRequest(context.Background(), cfg, operatorTestID, operatorTestAddress, 100, true)
	if err == nil || result.Status != "recovery_result_unknown" || !result.Executed || posts.Load() != 1 {
		t.Fatalf("first failure: %+v %v posts=%d", result, err, posts.Load())
	}
	result, err = InspectOrRecoverRequest(context.Background(), cfg, operatorTestID, operatorTestAddress, 100, true)
	if err != nil || result.Status != "recovery_result_unknown" || result.Executed || posts.Load() != 1 {
		t.Fatalf("second failure replay: %+v %v posts=%d", result, err, posts.Load())
	}
	if account, _ := core.Account(operatorTestAddress); account.Balance != 0 {
		t.Fatalf("unexpected credit %d", account.Balance)
	}
}
