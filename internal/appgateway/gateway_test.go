package appgateway

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	testChatKey   = "chat-key-1234567890"
	testSquareKey = "square-key-1234567890"
	testOrigin    = "https://www.ynxweb4.com"
)

type observedRequest struct {
	Method     string
	URI        string
	ServiceKey string
	Injected   string
	DeviceID   string
	Cookie     string
	Auth       string
	Body       string
}

type upstreamRecorder struct {
	mu       sync.Mutex
	requests []observedRequest
	service  string
	keyName  string
	key      string
	large    bool
}

func (u *upstreamRecorder) handler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/health" {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "service": "ynx-" + u.service + "d", "remoteDeployed": false, "truthfulStatus": "local-test"})
		return
	}
	body, _ := io.ReadAll(r.Body)
	u.mu.Lock()
	u.requests = append(u.requests, observedRequest{Method: r.Method, URI: r.URL.RequestURI(), ServiceKey: r.Header.Get(u.keyName), Injected: r.Header.Get("X-YNX-App-Gateway"), DeviceID: r.Header.Get("X-YNX-Device-ID"), Cookie: r.Header.Get("Cookie"), Auth: r.Header.Get("Authorization"), Body: string(body)})
	u.mu.Unlock()
	if u.large {
		_, _ = io.WriteString(w, strings.Repeat("x", 2048))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Upstream-Secret", "must-not-pass")
	w.WriteHeader(http.StatusCreated)
	_, _ = io.WriteString(w, `{"ok":true}`)
}

func TestGatewayProxiesAllowedRoutesWithoutLeakingCredentials(t *testing.T) {
	chat := &upstreamRecorder{service: "chat", keyName: "X-YNX-Chat-Key", key: testChatKey}
	square := &upstreamRecorder{service: "square", keyName: "X-YNX-Square-Key", key: testSquareKey}
	chatServer := httptest.NewServer(http.HandlerFunc(chat.handler))
	defer chatServer.Close()
	squareServer := httptest.NewServer(http.HandlerFunc(square.handler))
	defer squareServer.Close()
	gateway := newTestGateway(t, chatServer.URL, squareServer.URL, 20)
	server := httptest.NewServer(NewServer(gateway).Handler())
	defer server.Close()

	body := []byte(nil)
	request, _ := http.NewRequest(http.MethodGet, server.URL+"/app/square/feed?limit=10", nil)
	request.Header.Set("Origin", testOrigin)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-YNX-Device-ID", "device-1")
	request.Header.Set("X-YNX-Timestamp", "2026-07-14T00:00:00Z")
	request.Header.Set("X-YNX-Device-Signature", "must-not-be-trusted-by-gateway")
	request.Header.Set("X-YNX-Square-Key", "attacker-key")
	request.Header.Set("X-YNX-Chat-Key", "attacker-chat-key")
	request.Header.Set("Cookie", "session=must-not-pass")
	request.Header.Set("Authorization", "Bearer must-not-pass")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("status %d: %s", response.StatusCode, readAll(response.Body))
	}
	if response.Header.Get("Access-Control-Allow-Origin") != testOrigin || response.Header.Get("X-Upstream-Secret") != "" || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("unsafe or missing response headers: %v", response.Header)
	}
	square.mu.Lock()
	defer square.mu.Unlock()
	if len(square.requests) != 1 {
		t.Fatalf("requests: %+v", square.requests)
	}
	got := square.requests[0]
	if got.Method != http.MethodGet || got.URI != "/square/feed?limit=10" || got.ServiceKey != testSquareKey || got.Injected != "1" || got.DeviceID != "device-1" || got.Cookie != "" || got.Auth != "" || got.Body != string(body) {
		t.Fatalf("unsafe proxy request: %+v", got)
	}
	if len(chat.requests) != 0 {
		t.Fatalf("unexpected chat requests: %+v", chat.requests)
	}
}

func TestGatewayRoutesQueryAndSignedInternalPath(t *testing.T) {
	chat, chatServer := startUpstream(t, "chat", "X-YNX-Chat-Key", testChatKey)
	square, squareServer := startUpstream(t, "square", "X-YNX-Square-Key", testSquareKey)
	server := httptest.NewServer(NewServer(newTestGateway(t, chatServer.URL, squareServer.URL, 20)).Handler())
	defer server.Close()

	paths := []struct{ method, public, internal string }{
		{http.MethodGet, "/app/square/feed?limit=10&cursor=abc", "/square/feed?limit=10&cursor=abc"},
		{http.MethodGet, "/app/square/posts/post-1/comments", "/square/posts/post-1/comments"},
		{http.MethodGet, "/app/square/profiles/ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80/following", "/square/profiles/ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80/following"},
	}
	for _, item := range paths {
		request, _ := http.NewRequest(item.method, server.URL+item.public, strings.NewReader(`{}`))
		request.Header.Set("X-YNX-Device-ID", "device-1")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusCreated {
			t.Fatalf("%s status %d", item.public, response.StatusCode)
		}
	}
	all := append(square.snapshot(), chat.snapshot()...)
	if len(all) != len(paths) {
		t.Fatalf("observed requests: %+v", all)
	}
	for _, item := range paths {
		found := false
		for _, observed := range all {
			if observed.URI == item.internal {
				found = true
			}
		}
		if !found {
			t.Fatalf("missing internal path %s in %+v", item.internal, all)
		}
	}
}

func TestGatewayRejectsOriginsRoutesHeadersAndBounds(t *testing.T) {
	_, chatServer := startUpstream(t, "chat", "X-YNX-Chat-Key", testChatKey)
	square, squareServer := startUpstream(t, "square", "X-YNX-Square-Key", testSquareKey)
	gateway := newTestGateway(t, chatServer.URL, squareServer.URL, 20)
	server := httptest.NewServer(NewServer(gateway).Handler())
	defer server.Close()

	tests := []struct {
		name, method, path, origin string
		headers                    map[string]string
		body                       string
		want                       int
	}{
		{"bad origin", http.MethodGet, "/app/square/feed", "https://evil.example", nil, "", http.StatusForbidden},
		{"unknown route", http.MethodGet, "/app/square/metrics", "", nil, "", http.StatusNotFound},
		{"encoded escape", http.MethodGet, "/app/square/posts/%2e%2e", "", nil, "", http.StatusNotFound},
		{"mutating post needs ownership session", http.MethodPost, "/app/square/posts", "", nil, `{}`, http.StatusUnauthorized},
		{"device registration needs ownership session", http.MethodPost, "/app/square/devices", "", nil, `{}`, http.StatusUnauthorized},
		{"chat needs ownership session", http.MethodPost, "/app/chat/devices", "", nil, `{}`, http.StatusUnauthorized},
		{"large body", http.MethodGet, "/app/square/feed", "", nil, strings.Repeat("x", 4097), http.StatusRequestEntityTooLarge},
		{"bad preflight method", http.MethodOptions, "/app/square/posts", testOrigin, map[string]string{"Access-Control-Request-Method": "DELETE"}, "", http.StatusForbidden},
		{"bad preflight header", http.MethodOptions, "/app/square/feed", testOrigin, map[string]string{"Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Authorization"}, "", http.StatusForbidden},
		{"unknown preflight route", http.MethodOptions, "/app/square/metrics", testOrigin, map[string]string{"Access-Control-Request-Method": "GET"}, "", http.StatusNotFound},
		{"authenticated mutation preflight", http.MethodOptions, "/app/square/posts", testOrigin, map[string]string{"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "X-YNX-App-Session,X-YNX-Device-ID"}, "", http.StatusNoContent},
		{"good preflight", http.MethodOptions, "/app/square/feed", testOrigin, map[string]string{"Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Content-Type"}, "", http.StatusNoContent},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request, _ := http.NewRequest(test.method, server.URL+test.path, strings.NewReader(test.body))
			if test.origin != "" {
				request.Header.Set("Origin", test.origin)
			}
			for key, value := range test.headers {
				request.Header.Set(key, value)
			}
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != test.want {
				t.Fatalf("status %d want %d: %s", response.StatusCode, test.want, readAll(response.Body))
			}
		})
	}
	if len(square.snapshot()) != 0 {
		t.Fatalf("rejected request reached upstream: %+v", square.snapshot())
	}
}

func TestGatewayRateLimitResponseLimitAndHealth(t *testing.T) {
	_, chatServer := startUpstream(t, "chat", "X-YNX-Chat-Key", testChatKey)
	square, squareServer := startUpstream(t, "square", "X-YNX-Square-Key", testSquareKey)
	gateway := newTestGateway(t, chatServer.URL, squareServer.URL, 2)
	server := httptest.NewServer(NewServer(gateway).Handler())
	defer server.Close()

	response, err := http.Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	var health Health
	if err := json.NewDecoder(response.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK || !health.OK || health.RemoteDeployed || health.BrowserBoundary != "public-square-reads-account-bound-private-routes" || health.OwnershipProof != "ynx1-secp256k1-plus-ed25519-device" || health.SessionStorage == "" || len(health.Upstreams) != 2 || health.TruthfulStatus != "local-browser-safe-gateway-not-remote-deployed" {
		t.Fatalf("health: %+v", health)
	}

	for index := 0; index < 3; index++ {
		request, _ := http.NewRequest(http.MethodGet, server.URL+"/app/square/feed", nil)
		request.RemoteAddr = "192.0.2.10:1234"
		recorder := httptest.NewRecorder()
		NewServer(gateway).Handler().ServeHTTP(recorder, request)
		want := http.StatusCreated
		if index == 2 {
			want = http.StatusTooManyRequests
		}
		if recorder.Code != want {
			t.Fatalf("rate request %d status %d want %d", index, recorder.Code, want)
		}
	}

	square.large = true
	other := newTestGateway(t, chatServer.URL, squareServer.URL, 20)
	other.cfg.MaxResponseBytes = 1024
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/app/square/feed", nil)
	NewServer(other).Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("large response status %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestValidateConfigFailClosed(t *testing.T) {
	valid := testConfig(t, "http://127.0.0.1:6435", "http://localhost:6436", 20)
	for name, mutate := range map[string]func(*Config){
		"remote chat upstream": func(c *Config) { c.ChatURL = "https://chat.example" },
		"short key":            func(c *Config) { c.SquareAPIKey = "short" },
		"wildcard origin":      func(c *Config) { c.AllowedOrigins = []string{"*"} },
		"http origin":          func(c *Config) { c.AllowedOrigins = []string{"http://www.ynxweb4.com"} },
		"path origin":          func(c *Config) { c.AllowedOrigins = []string{"https://www.ynxweb4.com/path"} },
		"body limit":           func(c *Config) { c.MaxBodyBytes = 10 },
	} {
		t.Run(name, func(t *testing.T) {
			cfg := valid
			cfg.AllowedOrigins = append([]string(nil), valid.AllowedOrigins...)
			mutate(&cfg)
			if err := ValidateConfig(cfg); err == nil {
				t.Fatal("invalid config accepted")
			}
		})
	}
}

func testConfig(t *testing.T, chatURL, squareURL string, rate int) Config {
	t.Helper()
	return Config{ChatURL: chatURL, ChatAPIKey: testChatKey, SquareURL: squareURL, SquareAPIKey: testSquareKey, AllowedOrigins: []string{testOrigin, "https://ynxweb4.com"}, MaxBodyBytes: 4096, MaxResponseBytes: 4096, RateLimitMax: rate, RateLimitWindow: time.Minute, StatePath: filepath.Join(t.TempDir(), "state.json"), ChainID: 6423, ChallengeTTL: 5 * time.Minute, SessionTTL: 30 * time.Minute, Now: time.Now}
}

func newTestGateway(t *testing.T, chatURL, squareURL string, rate int) *Gateway {
	t.Helper()
	gateway, err := New(testConfig(t, chatURL, squareURL, rate))
	if err != nil {
		t.Fatal(err)
	}
	return gateway
}

func startUpstream(t *testing.T, service, keyName, key string) (*upstreamRecorder, *httptest.Server) {
	t.Helper()
	recorder := &upstreamRecorder{service: service, keyName: keyName, key: key}
	server := httptest.NewServer(http.HandlerFunc(recorder.handler))
	t.Cleanup(server.Close)
	return recorder, server
}

func (u *upstreamRecorder) snapshot() []observedRequest {
	u.mu.Lock()
	defer u.mu.Unlock()
	return append([]observedRequest(nil), u.requests...)
}

func readAll(reader io.Reader) string {
	data, _ := io.ReadAll(reader)
	return string(data)
}
