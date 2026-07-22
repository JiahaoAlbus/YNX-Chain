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
