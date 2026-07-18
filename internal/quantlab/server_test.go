package quantlab

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestHTTPWriteBoundaryAndStrictSchema(t *testing.T) {
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	server := httptest.NewServer(NewServer(s))
	defer server.Close()
	body := `{"reason":"operator test"}`
	r, _ := http.Post(server.URL+"/v1/risk/kill", "application/json", strings.NewReader(body))
	if r.StatusCode != 403 {
		t.Fatalf("missing boundary=%d", r.StatusCode)
	}
	req, _ := http.NewRequest("POST", server.URL+"/v1/risk/kill", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Preview-Mode", "local-paper")
	r, _ = server.Client().Do(req)
	if r.StatusCode != 200 {
		t.Fatalf("local boundary=%d", r.StatusCode)
	}
	req, _ = http.NewRequest("POST", server.URL+"/v1/risk/kill", strings.NewReader(`{"reason":"operator test","unknown":true}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Preview-Mode", "local-paper")
	r, _ = server.Client().Do(req)
	if r.StatusCode != 400 {
		t.Fatalf("unknown field=%d", r.StatusCode)
	}
}
