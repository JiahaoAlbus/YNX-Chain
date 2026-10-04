package finance

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestFinanceEvidenceNeverFollowsCredentialRedirects(t *testing.T) {
	for _, status := range []int{301, 302, 303, 307, 308} {
		for _, sameOrigin := range []bool{false, true} {
			t.Run(strconv.Itoa(status)+"/same="+strconv.FormatBool(sameOrigin), func(t *testing.T) {
				var forwarded, originalPolicy atomic.Int64
				target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { forwarded.Add(1); w.Write([]byte(`{"events":[]}`)) }))
				defer target.Close()
				owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/redirect-target" {
						forwarded.Add(1)
						return
					}
					location := target.URL
					if sameOrigin {
						location = "/redirect-target"
					}
					w.Header().Set("Location", location)
					w.WriteHeader(status)
				}))
				defer owner.Close()
				client := owner.Client()
				client.CheckRedirect = func(*http.Request, []*http.Request) error { originalPolicy.Add(1); return nil }
				u := &Upstreams{client: client}
				var payload map[string]any
				if err := u.get(context.Background(), owner.URL+"/pay/events", "isolated-read-key", &payload); err == nil {
					t.Fatal("redirected Pay evidence accepted")
				}
				if err := u.ConfigureReadSourceIntegrations(ReadSourceIntegrationConfig{ExchangeURL: owner.URL, ExchangeKey: strings.Repeat("k", 32)}); err != nil {
					t.Fatal(err)
				}
				result := u.ReadSourcesForAccount(context.Background(), testAccount, time.Now().UTC())["exchange"]
				if result.Status.Available || result.Envelope != nil || result.Status.SyncStatus != "owner-response-rejected" {
					t.Fatalf("redirected signed evidence=%+v", result)
				}
				if forwarded.Load() != 0 || originalPolicy.Load() != 0 {
					t.Fatalf("forwarded=%d policy=%d", forwarded.Load(), originalPolicy.Load())
				}
				_ = client.CheckRedirect(nil, nil)
				if originalPolicy.Load() != 1 {
					t.Fatal("supplied policy mutated")
				}
			})
		}
	}
}

func TestFinanceUpstreamBoundedSingleDocumentResponse(t *testing.T) {
	for _, raw := range []string{`{"ok":true}{"balance":99}`, `{"ok":true}garbage`, strings.Repeat(" ", maxReadSourceEnvelopeBytes) + `{"ok":true}`, `<html>fallback</html>`, `null`, `[]`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(raw)) }))
		u := &Upstreams{client: server.Client()}
		var out map[string]any
		err := u.get(context.Background(), server.URL, "", &out)
		server.Close()
		if err == nil {
			t.Fatal("invalid evidence framing/size accepted")
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("{\"ok\":true}\n \t")) }))
	defer server.Close()
	var out map[string]any
	if err := (&Upstreams{}).get(context.Background(), server.URL, "", &out); err != nil || out["ok"] != true {
		t.Fatalf("valid/nil-client read err=%v", err)
	}
}

func TestFinanceUpstreamRejectsCredentialBearingBaseURLs(t *testing.T) {
	for _, value := range []string{"https://user:secret@example.test", "https://example.test?token=secret", "https://example.test#fragment", "https://example.test?", "https://example.test#", "https://example.test/prefix?", "https://example.test/prefix#"} {
		if _, err := requireHTTPURL(value); err == nil || strings.Contains(err.Error(), value) {
			t.Fatal("unsafe base accepted or configuration echoed in error")
		}
		if _, err := NewUpstreams(value, "", "", ""); err == nil {
			t.Fatal("unsafe Explorer base accepted")
		}
		if _, err := NewUpstreams("https://example.test", value, "configured-key", ""); err == nil {
			t.Fatal("unsafe Pay base accepted")
		}
		if err := (&Upstreams{}).ConfigureReadSourceIntegrations(ReadSourceIntegrationConfig{ExchangeURL: value, ExchangeKey: strings.Repeat("k", 32)}); err == nil {
			t.Fatal("unsafe owner base accepted")
		}
	}
}

func TestFinanceUpstreamCompatibleBaseURLPaths(t *testing.T) {
	for _, value := range []string{"https://example.test", "https://example.test/", "http://127.0.0.1:6483", "https://example.test/prefix/", "https://example.test/path%3Fname%23suffix"} {
		u, err := NewUpstreams(value, value, "configured-key", "")
		if err != nil {
			t.Fatalf("compatible base rejected: %v", err)
		}
		want := strings.TrimRight(value, "/")
		if u.ExplorerURL != want || u.PayURL != want {
			t.Fatal("compatible base changed unexpectedly")
		}
		if err := u.ConfigureReadSourceIntegrations(ReadSourceIntegrationConfig{ExchangeURL: value, ExchangeKey: strings.Repeat("k", 32)}); err != nil {
			t.Fatalf("compatible owner base rejected: %v", err)
		}
	}
}
