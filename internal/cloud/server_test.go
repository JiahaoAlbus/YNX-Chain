package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestServerAuthorizationScopeAndStrictJSON(t *testing.T) {
	now := time.Now().UTC()
	s := testService(t, func(c *Config) { c.Now = func() time.Time { return now } })
	handler := NewServer(s).Handler()
	envelope := testWalletEnvelope(t, s, "cloud", "n", []string{"files.read"})
	token, _, err := s.CreateSession(context.Background(), envelope)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/objects", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401 got %d", rr.Code)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/v1/objects", bytes.NewBufferString(`{"kind":"folder","name":"x","unknown":true}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 403 {
		t.Fatalf("scope must fail before parse: %d %s", rr.Code, rr.Body.String())
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/objects", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("read: %d %s", rr.Code, rr.Body.String())
	}
	var objects []Object
	if err := json.NewDecoder(rr.Body).Decode(&objects); err != nil {
		t.Fatal(err)
	}
	if rr.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("missing CSP")
	}
	envelope = testWalletEnvelope(t, s, "cloud", "n2", []string{"files.read", "files.write"})
	token, _, err = s.CreateSession(context.Background(), envelope)
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/v1/objects", bytes.NewBufferString(`{"kind":"folder","name":"x","unknown":true}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 400 {
		t.Fatalf("strict JSON want 400 got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestServerRangeDownload(t *testing.T) {
	s := testService(t, nil)
	obj, err := s.Create(context.Background(), owner, CreateObjectRequest{Kind: KindFile, Name: "range.txt", MIME: "text/plain", Content: []byte("0123456789")})
	if err != nil {
		t.Fatal(err)
	}
	envelope := testWalletEnvelope(t, s, "cloud", "range", []string{"files.read"})
	token, _, err := s.CreateSession(context.Background(), envelope)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/objects/"+obj.ID+"/content", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Range", "bytes=2-5")
	rr := httptest.NewRecorder()
	NewServer(s).Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusPartialContent || rr.Body.String() != "2345" || rr.Header().Get("Content-Range") != "bytes 2-5/10" {
		t.Fatalf("range: %d %q %q", rr.Code, rr.Body.String(), rr.Header().Get("Content-Range"))
	}
}

func TestPublicAndRestrictedHealthObservability(t *testing.T) {
	s := testService(t, nil)
	server := NewServer(s)
	handler := server.Handler()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 200 || rr.Header().Get("X-Request-ID") == "" {
		t.Fatalf("public health: %d %#v", rr.Code, rr.Header())
	}
	var public map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&public); err != nil {
		t.Fatal(err)
	}
	if _, ok := public["objects"]; ok {
		t.Fatal("public health leaked object count")
	}
	if _, ok := public["durability"]; ok {
		t.Fatal("public health leaked provider boundary")
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/metrics", nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 401 || rr.Header().Get("X-Error-ID") == "" || rr.Header().Get("X-Request-ID") == "" {
		t.Fatalf("error IDs: %d %#v", rr.Code, rr.Header())
	}
	envelope := testWalletEnvelope(t, s, "cloud", "metrics", []string{"audit.read"})
	token, _, err := s.CreateSession(context.Background(), envelope)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/v1/health", "/api/v1/metrics"} {
		req = httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rr = httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != 200 {
			t.Fatalf("%s: %d %s", path, rr.Code, rr.Body.String())
		}
	}
	var metrics map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&metrics); err != nil {
		t.Fatal(err)
	}
	if metrics["source"] != "ynx-cloudd in-process counters" || metrics["coverage"] == nil {
		t.Fatalf("metrics provenance: %#v", metrics)
	}
}
