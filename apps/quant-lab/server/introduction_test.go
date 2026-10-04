package main

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/quantlab"
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

// Exercise the real product handler and tracked assets, not an API marker or
// browser interception. No account, private session or market adapter is made.
func TestQuantIntroductionRealHTTPRestartAndConcurrentGuests(t *testing.T) {
	web := filepath.Join("..", "web")
	intro, err := os.ReadFile(filepath.Join(web, "introduction.html"))
	if err != nil {
		t.Fatal(err)
	}
	app, err := os.ReadFile(filepath.Join(web, "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(t.TempDir(), "state.json")
	for launch := 0; launch < 2; launch++ {
		api, err := quantlab.NewTenantServer(quantlab.Config{StatePath: state}, "all")
		if err != nil {
			t.Fatal(err)
		}
		mux := http.NewServeMux()
		registerFinanceOwnerRead(mux, api)
		mux.Handle("/api/", http.StripPrefix("/api", api))
		for _, callback := range []string{"/wallet-auth/callback", "/wallet-action/callback"} {
			mux.HandleFunc(callback, func(w http.ResponseWriter, r *http.Request) {
				http.ServeFile(w, r, filepath.Join(web, "index.html"))
			})
		}
		mux.Handle("/", publicEntry(web))
		server := httptest.NewServer(headers(mux))
		client := server.Client()
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		var wg sync.WaitGroup
		for guest := 0; guest < 8; guest++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for _, tc := range []struct {
					path string
					body []byte
				}{
					{"/", intro}, {"/app", app}, {"/index.html", app},
					{"/?state=preserved", app}, {"/app?state=preserved", app},
					{"/wallet-auth/callback?requestId=preserved", app},
					{"/wallet-action/callback?requestId=preserved", app},
				} {
					response, err := client.Get(server.URL + tc.path)
					if err != nil {
						t.Error(err)
						return
					}
					body, readErr := io.ReadAll(response.Body)
					response.Body.Close()
					if readErr != nil || response.StatusCode != 200 || !bytes.Equal(body, tc.body) {
						t.Errorf("launch %d %s: status=%d bytes=%d err=%v", launch, tc.path, response.StatusCode, len(body), readErr)
					}
					if response.Header.Get("Cache-Control") != "no-store" || response.Header.Get("Referrer-Policy") != "no-referrer" || response.Header.Get("Content-Security-Policy") == "" {
						t.Errorf("%s: missing original application security headers", tc.path)
					}
					if len(response.Cookies()) != 0 {
						t.Errorf("%s: guest created session", tc.path)
					}
				}
			}()
		}
		wg.Wait()
		for _, route := range []string{"/api/health", "/api/version"} {
			response, err := client.Get(server.URL + route)
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(response.Body)
			response.Body.Close()
			if err != nil || response.StatusCode != 200 || !bytes.Contains(body, []byte(`"productId":"`+quantlab.ProductID+`"`)) || bytes.Equal(body, intro) {
				t.Errorf("%s: product API intercepted, status=%d body=%s err=%v", route, response.StatusCode, body, err)
			}
		}
		response, err := client.Head(server.URL + "/app")
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || response.StatusCode != 200 || len(body) != 0 || response.Header.Get("Cache-Control") != "no-store" {
			t.Error("HEAD changed original app semantics")
		}
		server.Close()
		api.Close()
	}
}

func TestQuantIntroductionMissingOrSymlinkFallsBackToWorkspace(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("workspace"), 0600); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "untrusted-introduction.html")
	if err := os.WriteFile(outside, []byte("must not become public root"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, linked := range []bool{false, true} {
		if linked {
			if err := os.Symlink(outside, filepath.Join(dir, "introduction.html")); err != nil {
				t.Fatal(err)
			}
		}
		w := httptest.NewRecorder()
		publicEntry(dir).ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
		if w.Code != 200 || w.Body.String() != "workspace" {
			t.Fatalf("fallback linked=%v: %d %q", linked, w.Code, w.Body.String())
		}
	}
}
