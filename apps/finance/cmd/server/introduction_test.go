package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestPublicIntroductionRoutesPreserveApplication(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "introduction.html"), []byte("public introduction"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "introduction.css"), []byte("intro styles"), 0600); err != nil {
		t.Fatal(err)
	}
	var path, query, method string
	original := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path, query, method = r.URL.Path, r.URL.RawQuery, r.Method
		w.WriteHeader(202)
		_, _ = w.Write([]byte("original application"))
	})
	handler := introductionHandler(original, dir)
	for _, tc := range []struct {
		target, expected string
		code             int
	}{
		{"/", "public introduction", 200},
		{"/app", "original application", 202},
		{"/app?code=auth&state=exact", "original application", 202},
		{"/index.html", "original application", 202},
		{"/?code=auth&state=exact", "original application", 202},
		{"/auth/callback?code=auth", "original application", 202},
		{"/wallet-auth/callback?requestId=exact", "original application", 202},
		{"/api/portfolio", "original application", 202},
		{"/version", "original application", 202},
		{"/health", "original application", 202},
		{"/downloads/finance.apk", "original application", 202},
		{"/introduction.css/../private", "original application", 202},
		{"/introduction.css", "intro styles", 200},
	} {
		t.Run(tc.target, func(t *testing.T) {
			r := httptest.NewRequest("GET", tc.target, nil)
			before := r.URL.String()
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != tc.code || w.Body.String() != tc.expected {
				t.Fatalf("%d %q", w.Code, w.Body.String())
			}
			if r.URL.String() != before {
				t.Fatal("mutated caller request")
			}
			if tc.target == "/app" || tc.target == "/index.html" || tc.target == "/app?code=auth&state=exact" {
				if path != "/" {
					t.Fatalf("application forwarded to %q", path)
				}
			}
			if (tc.target == "/?code=auth&state=exact" || tc.target == "/app?code=auth&state=exact") && query != "code=auth&state=exact" {
				t.Fatal("lost auth query")
			}
		})
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("POST", "/api/orders?intent=exact", nil))
	if method != "POST" || path != "/api/orders" || query != "intent=exact" || w.Code != 202 {
		t.Fatal("write route intercepted")
	}
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("HEAD", "/", nil))
	if w.Code != 200 || w.Body.Len() != 0 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("HEAD public entry contract failed")
	}
}

func TestIntroductionMissingOrSymlinkDoesNotReplaceExistingApp(t *testing.T) {
	dir := t.TempDir()
	original := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("existing app")) })
	handler := introductionHandler(original, dir)
	for _, symlink := range []bool{false, true} {
		if symlink {
			outside := filepath.Join(t.TempDir(), "outside.html")
			if err := os.WriteFile(outside, []byte("foreign"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(outside, filepath.Join(dir, "introduction.html")); err != nil {
				t.Fatal(err)
			}
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
		if w.Body.String() != "existing app" {
			t.Fatal("missing/foreign introduction intercepted app")
		}
	}
}
