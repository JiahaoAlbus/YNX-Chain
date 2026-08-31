package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

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
	client := "203.0.113.209"
	digest := sha256.Sum256([]byte("ynx-exchange-admission-v1\x00" + client))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	t.Cleanup(func() {
		_, _ = first.store.(*postgresAdmissionStore).db.ExecContext(ctx, `DELETE FROM ynx_exchange_admission_windows WHERE client_hash = $1`, hex.EncodeToString(digest[:]))
	})
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
