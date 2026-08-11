package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestNativeDEXCacheServesAuthoritativeSnapshotAndFallsThrough(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"source":"authoritative chain-native YNX Testnet state","items":[{"id":"one"}]}`))
	}))
	defer upstream.Close()
	cache := newNativeDEXCache(upstream.URL, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	if err := cache.refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	cache.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/dex/pools", nil))
	if response.Code != http.StatusOK || response.Header().Get("ETag") == "" || response.Header().Get("X-YNX-Authoritative-Snapshot-Age") == "" {
		t.Fatalf("cached authoritative response missing evidence headers: %d %v", response.Code, response.Header())
	}
	passedThrough := httptest.NewRecorder()
	cache.ServeHTTP(passedThrough, httptest.NewRequest(http.MethodPost, "/dex/pools", nil))
	if passedThrough.Code != http.StatusTeapot {
		t.Fatalf("mutation did not fall through: %d", passedThrough.Code)
	}
}

func TestNativeDEXCacheRejectsUntrustedAndExpiresStaleSnapshot(t *testing.T) {
	body := `{"source":"untrusted","items":[]}`
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) }))
	defer upstream.Close()
	cache := newNativeDEXCache(upstream.URL, http.NotFoundHandler())
	if err := cache.refresh(context.Background()); err == nil {
		t.Fatal("untrusted source was accepted")
	}
	cache.entries["/dex/pools"] = nativeDEXCacheEntry{body: []byte(`{"items":[]}`), fetchedAt: time.Now().Add(-3 * time.Minute)}
	response := httptest.NewRecorder()
	cache.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/dex/pools", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("stale response did not fail closed: %d", response.Code)
	}
}
