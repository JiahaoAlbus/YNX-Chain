package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestQuantPublicEntryPreservesAppAndAPIs(t *testing.T) {
	dir := t.TempDir()
	for name, content := range map[string]string{"index.html": "existing workspace", "introduction.html": "public introduction"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(202) })
	mux.HandleFunc("/wallet-auth/callback", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(r.URL.RawQuery)) })
	mux.Handle("/", publicEntry(dir))
	for _, tc := range []struct {
		url, body string
		status    int
	}{
		{"/", "public introduction", 200}, {"/app", "existing workspace", 200}, {"/index.html", "existing workspace", 200},
		{"/?code=exact", "existing workspace", 200}, {"/app?state=exact", "existing workspace", 200},
		{"/wallet-auth/callback?requestId=exact", "requestId=exact", 200}, {"/api/orders", "", 202},
	} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", tc.url, nil))
		if w.Code != tc.status || w.Body.String() != tc.body {
			t.Fatalf("%s: %d %q", tc.url, w.Code, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("POST", "/api/orders", nil))
	if w.Code != 202 {
		t.Fatal("write intercepted")
	}
}
