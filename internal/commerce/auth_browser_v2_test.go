//go:build commerce_v2

package commerce

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Uses actual protected private control authority, actual Central Browser store,
// actual SDK software signatures and Go consumer. No production Wallet or Host.
func TestCommerceCombinedBrowserActualAuthorities(t *testing.T) {
	if os.Getenv("YNX_QA_CENTRAL_SOURCE") == "" {
		t.Skip("requires explicit frozen SDK composition")
	}
	for _, terminal := range []string{"browser-revoke", "private-revoke", "generation", "actor", "replacement"} {
		t.Run(terminal, func(t *testing.T) {
			public, key, _ := ed25519.GenerateKey(rand.Reader)
			der, _ := x509.MarshalPKIXPublicKey(public)
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			dir := t.TempDir()
			_ = os.Chmod(dir, 0700)
			cmd := exec.CommandContext(ctx, "node", "testdata/browser-business-node.mjs")
			cmd.Env = append(os.Environ(), "YNX_QA_PUBLIC_KEY="+string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})), "YNX_QA_STATE_PATH="+filepath.Join(dir, "authority"))
			var diagnostics bytes.Buffer
			cmd.Stderr = &diagnostics
			pipe, _ := cmd.StdoutPipe()
			input, _ := cmd.StdinPipe()
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
			scanner := bufio.NewScanner(pipe)
			scanner.Buffer(make([]byte, 4096), 65536)
			var ready struct {
				URL     string
				Session v2.Session
			}
			if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &ready) != nil {
				t.Fatal("authority startup", diagnostics.String())
			}
			local, _ := url.Parse(ready.URL)
			var combined, separate atomic.Int32
			transport := commerceV2RoundTrip(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path == "/v2/browser-sessions/product-browser-revalidate" {
					combined.Add(1)
				}
				if r.URL.Path == "/v2/browser-sessions/product-revalidate" {
					separate.Add(1)
				}
				copy := r.Clone(r.Context())
				u := *r.URL
				copy.URL = &u
				copy.URL.Scheme = local.Scheme
				copy.URL.Host = local.Host
				return http.DefaultTransport.RoundTrip(copy)
			})
			store, err := Open(filepath.Join(dir, "commerce.json"))
			if err != nil {
				t.Fatal(err)
			}
			active := true
			server, err := NewCommerceCombinedWebV2Server(store, ServerConfig{}, "qa", key, bytes.Repeat([]byte{7}, 32), transport, func(_ *http.Request, s v2.Session, g v2.BrowserGrant, binding string) (func() error, error) {
				if s.SessionBinding != ready.Session.SessionBinding || s.Account != ready.Session.Account || g.Identity.Account != s.Account || binding == "" {
					return nil, ErrUnauthorized
				}
				return func() error {
					if !active {
						return ErrUnauthorized
					}
					return nil
				}, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			control := func(path string, body any) map[string]any {
				raw, _ := json.Marshal(body)
				response, err := http.Post(ready.URL+"/__qa/"+path, "application/json", bytes.NewReader(raw))
				if err != nil {
					t.Fatal(err)
				}
				defer response.Body.Close()
				var result map[string]any
				if response.StatusCode != 200 || json.NewDecoder(response.Body).Decode(&result) != nil {
					t.Fatal("authority control failed", path)
				}
				return result
			}
			var cookie *http.Cookie
			login := func() string {
				start := httptest.NewRecorder()
				server.Handler().ServeHTTP(start, httptest.NewRequest("GET", "https://shop.ynxweb4.com/sso/start?target=overview", nil))
				if start.Code != 303 {
					t.Fatal("identity start", start.Code, start.Body.String())
				}
				approved := control("approve-url", map[string]any{"url": start.Header().Get("Location")})
				callback := httptest.NewRequest("GET", approved["redirectUri"].(string), nil)
				for _, c := range start.Result().Cookies() {
					callback.AddCookie(c)
				}
				out := httptest.NewRecorder()
				server.Handler().ServeHTTP(out, callback)
				if out.Code != 303 {
					t.Fatal("identity callback", out.Code, out.Body.String())
				}
				for _, c := range out.Result().Cookies() {
					if c.Name == "__Host-ynx-shop-identity" {
						cookie = c
					}
				}
				if cookie == nil || !cookie.HttpOnly || !cookie.Secure {
					t.Fatal("original secure identity cookie missing")
				}
				req := httptest.NewRequest("GET", "https://shop.ynxweb4.com/api/sso/account", nil)
				req.AddCookie(cookie)
				account := httptest.NewRecorder()
				server.Handler().ServeHTTP(account, req)
				var data struct {
					Account, CSRFToken         string
					PrivateWorkspaceAuthorized bool
				}
				if account.Code != 200 || json.Unmarshal(account.Body.Bytes(), &data) != nil || data.Account != ready.Session.Account || data.PrivateWorkspaceAuthorized || data.CSRFToken == "" {
					t.Fatal("identity response broadened private authority", account.Code)
				}
				return data.CSRFToken
			}
			csrf := login()
			request := func(body, wire, origin, csrfValue string, reuse, proofs bool) *httptest.ResponseRecorder {
				command, _ := json.Marshal(map[string]any{"method": "PUT", "path": "/api/profile", "body": body, "scopes": []string{"account:read", "shop:profile:write"}, "reuseAction": reuse})
				if _, err := input.Write(append(command, '\n')); err != nil {
					t.Fatal(err)
				}
				var headers struct{ Introspection, Action string }
				if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &headers) != nil {
					t.Fatal("proof pipe", diagnostics.String())
				}
				req := httptest.NewRequest("PUT", "https://shop.ynxweb4.com/api/profile", bytes.NewBufferString(wire))
				req.AddCookie(cookie)
				req.Header.Set("Origin", origin)
				req.Header.Set("X-YNX-SSO-CSRF", csrfValue)
				if proofs {
					req.Header.Set(v2.ProofHeader, headers.Introspection)
					req.Header.Set(v2.ActionProofHeader, headers.Action)
				}
				response := httptest.NewRecorder()
				server.Handler().ServeHTTP(response, req)
				return response
			}
			body := `{"displayName":"Original buyer"}`
			if r := request(body, body, "https://shop.ynxweb4.com", csrf, false, false); r.Code != 401 {
				t.Fatal("identity alone admitted", r.Code)
			}
			if r := request(body, body, "https://evil.invalid", csrf, false, true); r.Code != 403 {
				t.Fatal("cross-origin admitted", r.Code)
			}
			if r := request(body, body, "https://shop.ynxweb4.com", "wrong", false, true); r.Code != 403 {
				t.Fatal("wrong CSRF admitted", r.Code)
			}
			if r := request(body, `{"displayName":"Tampered"}`, "https://shop.ynxweb4.com", csrf, false, true); r.Code != 403 {
				t.Fatal("tampered body admitted", r.Code, r.Body.String())
			}
			before := combined.Load()
			if r := request(body, body, "https://shop.ynxweb4.com", csrf, false, true); r.Code != 200 {
				t.Fatal("combined profile failed", r.Code, r.Body.String(), diagnostics.String())
			}
			if combined.Load() <= before || separate.Load() != 0 {
				t.Fatal("private business bypassed combined authority")
			}
			if r := request(body, body, "https://shop.ynxweb4.com", csrf, true, true); r.Code != 409 {
				t.Fatal("replayed action admitted", r.Code)
			}
			store.mu.Lock()
			snapshot, _ := cloneSnapshot(store.s)
			store.mu.Unlock()
			if len(snapshot.BusinessBrowserBindings) != 1 {
				t.Fatal("original Browser association missing")
			}
			switch terminal {
			case "actor":
				active = false
			case "replacement":
				csrf = login()
			default:
				control(terminal, map[string]any{})
			}
			r := request(body, body, "https://shop.ynxweb4.com", csrf, false, true)
			if r.Code == 200 {
				t.Fatal("terminal authority admitted", terminal)
			}
			store.mu.Lock()
			after, _ := cloneSnapshot(store.s)
			store.mu.Unlock()
			// Rate admission records denied requests; business state must remain exact.
			snapshot.RequestWindow = after.RequestWindow
			oldBytes, _ := json.Marshal(snapshot)
			newBytes, _ := json.Marshal(after)
			if !bytes.Equal(oldBytes, newBytes) {
				var oldFields, newFields map[string]json.RawMessage
				_ = json.Unmarshal(oldBytes, &oldFields)
				_ = json.Unmarshal(newBytes, &newFields)
				for name, value := range oldFields {
					if !bytes.Equal(value, newFields[name]) {
						t.Errorf("changed Store field %s", name)
					}
				}
				t.Fatal("rejection changed original Store", terminal)
			}
			// Authority rejection must not leak the private profile.
			if bytes.Contains(r.Body.Bytes(), []byte("Original buyer")) {
				t.Fatal("rejection leaked private data")
			}
		})
	}
}
