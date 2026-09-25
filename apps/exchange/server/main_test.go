package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/exchangeproduct"
)

func TestGuestMarketModuleIsServedWithJavaScriptMIMEAndExactBytes(t *testing.T) {
	for _, module := range []string{"market-data.js", "order-preview.js", "wallet-connect.js", "private-session.js"} {
		expected, err := os.ReadFile("../web/" + module)
		if err != nil {
			t.Fatal(err)
		}
		res := httptest.NewRecorder()
		spa(http.Dir("../web")).ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/"+module, nil))
		if res.Code != http.StatusOK || !strings.Contains(res.Header().Get("Content-Type"), "javascript") || !bytes.Equal(res.Body.Bytes(), expected) {
			t.Fatalf("module was not served exactly: status=%d mime=%s", res.Code, res.Header().Get("Content-Type"))
		}
	}
}

func TestHTMLRefreshesBeforeVersionedExchangeAssets(t *testing.T) {
	for _, route := range []string{"/", "/wallet-auth/callback", "/index.html"} {
		res := httptest.NewRecorder()
		spa(http.Dir("../web")).ServeHTTP(res, httptest.NewRequest(http.MethodGet, route, nil))
		if res.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("HTML route %s cache policy=%q", route, res.Header().Get("Cache-Control"))
		}
	}
	for _, module := range []string{"market-data.js", "order-preview.js", "private-session.js", "app.js", "wallet-connect.js"} {
		body, err := os.ReadFile("../web/" + module)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(body)
		res := httptest.NewRecorder()
		spa(http.Dir("../web")).ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/"+module+"?v="+hex.EncodeToString(digest[:]), nil))
		if res.Code != http.StatusOK || !bytes.Equal(res.Body.Bytes(), body) {
			t.Fatalf("versioned Exchange module %s status=%d", module, res.Code)
		}
	}
}

func TestPrivateSessionCSPOnlyAddsFixedCanonicalAuthority(t *testing.T) {
	w := httptest.NewRecorder()
	securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })).ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	csp := w.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "connect-src 'self' https://wallet-auth.ynxweb4.com;") || strings.Contains(csp, "rpc.ynxweb4.com") || strings.Contains(csp, "*") || w.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("unexpected private authority CSP: %s", csp)
	}
}

func TestAdmissionRateLimitAndTrustedForwardedClient(t *testing.T) {
	gate := newAdmission(2, 2, time.Minute)
	handler := gate.wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	for attempt := 0; attempt < 3; attempt++ {
		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		req.RemoteAddr = "127.0.0.1:1234"
		req.Header.Set("X-Forwarded-For", "203.0.113.8")
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		want := http.StatusNoContent
		if attempt == 2 {
			want = http.StatusTooManyRequests
		}
		if res.Code != want {
			t.Fatalf("attempt %d: got %d want %d", attempt, res.Code, want)
		}
	}
}

func TestRequestClientIgnoresUntrustedForwardedHeader(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "198.51.100.9:4321"
	req.Header.Set("X-Forwarded-For", "203.0.113.10")
	if got := requestClient(req); got != "198.51.100.9" {
		t.Fatalf("got %q", got)
	}
}

type failingAdmissionStore struct{}

func (failingAdmissionStore) allow(string, time.Duration, int) (bool, error) {
	return false, os.ErrDeadlineExceeded
}
func (failingAdmissionStore) close() error { return nil }

func TestAdmissionFailsClosedWhenStoreIsUnavailable(t *testing.T) {
	gate := &admission{slots: make(chan struct{}, 1), limit: 1, window: time.Minute, store: failingAdmissionStore{}}
	res := httptest.NewRecorder()
	gate.wrap(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("handler must not run") })).ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/", nil))
	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d want=%d", res.Code, http.StatusServiceUnavailable)
	}
}

func TestPostgresAdmissionRejectsMissingDatabaseURL(t *testing.T) {
	if _, err := newPostgresAdmission(1, 1, time.Minute, " "); err == nil {
		t.Fatal("missing database URL was accepted")
	}
}

func TestSingleHostJSONCompatibilityKeepsGuestAndClosesUnconfiguredFinanceRead(t *testing.T) {
	gate, err := newConfiguredAdmission(128, 600, time.Minute, "")
	if err != nil {
		t.Fatal(err)
	}
	defer gate.Close()
	if _, ok := gate.store.(*memoryAdmissionStore); !ok {
		t.Fatal("empty database URL did not select single-host admission")
	}
	statePath := filepath.Join(t.TempDir(), "exchange-state.json")
	config := exchangeproduct.Config{StatePath: statePath, APIKey: strings.Repeat("k", 32), WalletCallback: "ynxexchange://wallet/callback"}
	service, err := exchangeproduct.New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	if _, err := os.Stat(statePath); err != nil {
		t.Fatalf("JSON state was not persisted: %v", err)
	}
	api := exchangeproduct.NewServer(service)
	if err := api.ConfigureFinanceReadKey(""); err != nil {
		t.Fatal(err)
	}
	for _, check := range []struct {
		path string
		want int
	}{
		{path: "/health", want: http.StatusOK},
		{path: "/v1/markets", want: http.StatusOK},
		{path: "/ready", want: http.StatusServiceUnavailable},
		{path: exchangeproduct.FinanceReadRoute, want: http.StatusServiceUnavailable},
	} {
		response := httptest.NewRecorder()
		gate.wrap(api).ServeHTTP(response, httptest.NewRequest(http.MethodGet, check.path, nil))
		if response.Code != check.want {
			t.Errorf("%s: status=%d want=%d body=%s", check.path, response.Code, check.want, response.Body.String())
		}
	}
	if backend, multiInstance := service.StorageStatus(); backend != "file_snapshot" || multiInstance {
		t.Fatalf("single-host JSON was overclaimed: backend=%s multiInstance=%t", backend, multiInstance)
	}
	before, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := exchangeproduct.New(config)
	if err != nil {
		t.Fatalf("second JSON startup failed: %v", err)
	}
	defer restarted.Close()
	after, err := os.ReadFile(statePath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("second startup changed persisted JSON state: err=%v", err)
	}
}

func TestConfiguredPostgresFailureNeverFallsBackToMemory(t *testing.T) {
	gate, err := newConfiguredAdmission(128, 600, time.Minute, "postgres://127.0.0.1:not-a-port/exchange")
	if err == nil || gate != nil {
		t.Fatalf("configured PostgreSQL failure must stop startup: gate=%v err=%v", gate, err)
	}
}

func TestPostgresAdmissionIsSharedAcrossInstances(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_EXCHANGE_POSTGRES_TEST_URL is not configured")
	}
	first, err := newPostgresAdmission(2, 2, time.Minute, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := newPostgresAdmission(2, 2, time.Minute, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	client := "203.0.113.209-" + time.Now().UTC().Format(time.RFC3339Nano)
	digest := sha256.Sum256([]byte("ynx-exchange-admission-v1\x00" + client))
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := first.store.(*postgresAdmissionStore).db.ExecContext(ctx, `DELETE FROM ynx_exchange_admission_windows WHERE client_hash = $1`, hex.EncodeToString(digest[:])); err != nil {
			t.Errorf("clean PostgreSQL admission fixture: %v", err)
		}
	}()
	for attempt, gate := range []*admission{first, second} {
		allowed, err := gate.allow(client)
		if err != nil || !allowed {
			t.Fatalf("attempt %d allowed=%t err=%v", attempt, allowed, err)
		}
	}
	allowed, err := first.allow(client)
	if err != nil {
		t.Fatal(err)
	}
	if allowed {
		t.Fatal("third request was accepted across PostgreSQL-backed instances")
	}
}
