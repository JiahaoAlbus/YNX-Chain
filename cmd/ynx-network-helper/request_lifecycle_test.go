package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type lifecycleTransport func(*http.Request) (*http.Response, error)

func (f lifecycleTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func awaitLifecycle(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(3 * time.Second):
		t.Fatal("request lifecycle did not settle")
	}
}

func TestP0903RevocationAndExpiryCancelInflightRPC(t *testing.T) {
	for _, expiry := range []bool{false, true} {
		name := "revoke"
		if expiry {
			name = "expiry"
		}
		t.Run(name, func(t *testing.T) {
			started, cancelled := make(chan struct{}), make(chan struct{})
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				close(started)
				select {
				case <-r.Context().Done():
					close(cancelled)
				case <-time.After(3 * time.Second):
				}
			}))
			defer upstream.Close()
			h, s := fixture(t, upstream.URL)
			ticket := pair(t, s)
			if expiry {
				h.mu.Lock()
				h.ticketCancel()
				h.ticketUntil = time.Now().Add(350 * time.Millisecond)
				h.ticketContext, h.ticketCancel = context.WithDeadline(context.Background(), h.ticketUntil)
				h.mu.Unlock()
			}
			done := make(chan struct{})
			var code int
			var out map[string]any
			go func() {
				defer close(done)
				code, out = call(t, s, "/api/lookup", s.URL, ticket, map[string]string{"txId": knownTx})
			}()
			awaitLifecycle(t, started)
			if !expiry {
				if status, _ := call(t, s, "/api/revoke", s.URL, ticket, nil); status != 200 {
					t.Fatal(status)
				}
			}
			awaitLifecycle(t, cancelled)
			awaitLifecycle(t, done)
			if code != 401 || out["error"] != "PAIRING_REQUIRED" {
				t.Fatalf("late response: %d %v", code, out)
			}
			if status, _ := call(t, s, "/api/lookup", s.URL, ticket, map[string]string{"txId": knownTx}); status != 401 {
				t.Fatalf("new work after invalidation: %d", status)
			}
		})
	}
}

func TestP0903LateTransportCannotPublishAfterRevocation(t *testing.T) {
	h, s := fixture(t, "https://rpc.example")
	ticket := pair(t, s)
	started, release := make(chan struct{}), make(chan struct{})
	h.client = &http.Client{Transport: lifecycleTransport(func(r *http.Request) (*http.Response, error) {
		close(started)
		<-release
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"status":"success"}`))}, nil
	})}
	done := make(chan struct{})
	var code int
	var out map[string]any
	go func() {
		defer close(done)
		code, out = call(t, s, "/api/lookup", s.URL, ticket, map[string]string{"txId": knownTx})
	}()
	awaitLifecycle(t, started)
	if status, _ := call(t, s, "/api/revoke", s.URL, ticket, nil); status != 200 {
		t.Fatal(status)
	}
	close(release)
	awaitLifecycle(t, done)
	if code != 401 || out["report"] != nil {
		t.Fatalf("published stale report: %d %v", code, out)
	}
}

func TestP0903RevokedProofResponseCannotPublish(t *testing.T) {
	h, s := fixture(t, "https://rpc.example")
	ticket := pair(t, s)
	r, _ := http.NewRequest(http.MethodPost, s.URL+"/api/verify", nil)
	r.Header.Set("Authorization", "Bearer "+ticket)
	ctx, release, ok := h.authorizedContext(r)
	if !ok {
		t.Fatal("paired context denied")
	}
	defer release()
	if status, _ := call(t, s, "/api/revoke", s.URL, ticket, nil); status != 200 {
		t.Fatal(status)
	}
	w := httptest.NewRecorder()
	h.sendAuthorizedJSON(w, r.WithContext(ctx), map[string]string{"level": "INCLUSION_VERIFIED"})
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if w.Code != 401 || out["level"] != nil {
		t.Fatalf("published revoked proof: %d %v", w.Code, out)
	}
}
