package quantlab

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
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

func TestWebSocketSnapshotCarriesAuthorityMetadata(t *testing.T) {
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	server := httptest.NewServer(NewRoleServer(s, "research"))
	defer server.Close()
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/v1/stream"
	connection, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	_, payload, err := connection.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]any
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope["type"] != "snapshot" || envelope["source"] != "ynx-quant-authoritative-local-state" || envelope["confidence"] != "authoritative" || envelope["version"] != Version || envelope["asOf"] == nil || envelope["data"] == nil {
		t.Fatalf("bad envelope: %#v", envelope)
	}
}

func TestServiceRolesExposeOnlyOwnedMutationRoutes(t *testing.T) {
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	cases := []struct{ role, allowed, denied string }{
		{"research", "/v1/backtests", "/v1/risk/kill"},
		{"paper", "/v1/paper/orders", "/v1/backtests"},
		{"risk", "/v1/risk/kill", "/v1/paper/orders"},
	}
	for _, tc := range cases {
		t.Run(tc.role, func(t *testing.T) {
			server := httptest.NewServer(NewRoleServer(s, tc.role))
			defer server.Close()
			for path, wantNotFound := range map[string]bool{tc.allowed: false, tc.denied: true} {
				req, _ := http.NewRequest("POST", server.URL+path, strings.NewReader(`{}`))
				req.Header.Set("X-YNX-Preview-Mode", "local-paper")
				response, err := server.Client().Do(req)
				if err != nil {
					t.Fatal(err)
				}
				_ = response.Body.Close()
				if (response.StatusCode == http.StatusNotFound) != wantNotFound {
					t.Fatalf("path=%s status=%d wantNotFound=%v", path, response.StatusCode, wantNotFound)
				}
			}
		})
	}
}
