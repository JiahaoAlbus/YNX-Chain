package aiproduct

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func TestWalletCallbackServesShellWithoutReflectingOrAuthorizing(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "state.json"), bytes.Repeat([]byte{8}, 32))
	if err != nil {
		t.Fatal(err)
	}
	page := "<!doctype html><title>YNX AI</title>"
	server, err := NewServer(Config{GatewayURL: "http://127.0.0.1:6429", GatewayKey: testGatewayKey, ExactWalletCallback: FormalCallback}, store, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte(page)}})
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/wallet-auth/callback?response=untrusted-callback-material", nil))
	if w.Code != http.StatusOK || w.Body.String() != page || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("unexpected callback shell response: status=%d body=%s", w.Code, w.Body.String())
	}
	if len(store.state.Sessions) != 0 {
		t.Fatal("callback navigation created a session")
	}
}
