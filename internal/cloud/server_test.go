package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestDirectUploadCSPIsExactAndOptional(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	for _, tc := range []struct{ origin, want string }{{"", "connect-src 'self';"}, {"https://uploads.ynx.network", "connect-src 'self' https://uploads.ynx.network;"}, {"https://uploads.ynx.network/path", "connect-src 'self';"}} {
		rr := httptest.NewRecorder()
		SecureHandlerWithDirectUploadOrigin(next, tc.origin).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/cloud/", nil))
		if got := rr.Header().Get("Content-Security-Policy"); !strings.Contains(got, tc.want) {
			t.Fatalf("origin %q CSP %q want %q", tc.origin, got, tc.want)
		}
	}
}

func TestRateLimitIgnoresForwardedIdentityAndResets(t *testing.T) {
	now := time.Now().UTC()
	s := testService(t, func(c *Config) { c.Now = func() time.Time { return now } })
	handler := NewServerWithLimits(s, ServerLimits{MaxConcurrent: 2, RequestsPerMinute: 2}).Handler()
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		req.RemoteAddr = "192.0.2.10:4321"
		req.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i))
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		want := 200
		if i == 2 {
			want = 429
		}
		if rr.Code != want {
			t.Fatalf("request %d got %d want %d", i, rr.Code, want)
		}
		if i == 2 && (rr.Header().Get("Retry-After") == "" || rr.Header().Get("X-Error-ID") == "") {
			t.Fatalf("rate limit headers: %#v", rr.Header())
		}
	}
	now = now.Add(time.Minute)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.RemoteAddr = "192.0.2.10:9999"
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("window did not reset: %d", rr.Code)
	}
}

func TestBackpressureRejectsWithoutQueueing(t *testing.T) {
	s := testService(t, nil)
	server := NewServerWithLimits(s, ServerLimits{MaxConcurrent: 1, RequestsPerMinute: 100})
	entered := make(chan struct{})
	release := make(chan struct{})
	handler := server.observe(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(entered); <-release; w.WriteHeader(204) }))
	done := make(chan struct{})
	go func() {
		req := httptest.NewRequest(http.MethodGet, "/slow", nil)
		req.RemoteAddr = "192.0.2.1:1"
		handler.ServeHTTP(httptest.NewRecorder(), req)
		close(done)
	}()
	<-entered
	req := httptest.NewRequest(http.MethodGet, "/slow", nil)
	req.RemoteAddr = "192.0.2.2:2"
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 503 || rr.Header().Get("Retry-After") != "1" || rr.Header().Get("X-Error-ID") == "" {
		t.Fatalf("backpressure: %d %#v", rr.Code, rr.Header())
	}
	close(release)
	<-done
	server.mu.Lock()
	rejected := server.rejections["backpressure"]
	server.mu.Unlock()
	if rejected != 1 {
		t.Fatalf("backpressure metric %d", rejected)
	}
}
