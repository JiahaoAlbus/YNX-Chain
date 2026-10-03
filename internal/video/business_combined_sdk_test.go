//go:build ynx_canonical_media && ynx_media_combined_authority

package video

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Actual combined641 Node authority, Go SDK, original PKCE sealed cookie and
// original product Store. Keys are ephemeral QA; this is not real Wallet/Host.
func TestMediaCombinedOriginalBrowserPrivateDecision(t *testing.T) {
	source := os.Getenv("YNX_QA_CENTRAL_SOURCE")
	if source == "" || os.Getenv("YNX_QA_MEDIA_APPROVED_BROWSER_ROSTER") != "1" {
		t.Skip("requires pinned complete641+approved258")
	}
	for _, tc := range [][2]string{{"video", "browser"}, {"video", "private"}, {"creator-studio", "browser"}, {"creator-studio", "private"}} {
		product, revokeKind := tc[0], tc[1]
		t.Run(product+"/"+revokeKind, func(t *testing.T) {
			public, key, err := ed25519.GenerateKey(rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			der, err := x509.MarshalPKIXPublicKey(public)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
			defer cancel()
			stateDirectory := t.TempDir()
			if err = os.Chmod(stateDirectory, 0700); err != nil {
				t.Fatal(err)
			}
			cmd := exec.CommandContext(ctx, "node", "testdata/media-combined-authority-node.mjs")
			cmd.Env = append(os.Environ(), "YNX_QA_CENTRAL_SOURCE="+source, "YNX_QA_PRODUCT_ID="+product, "YNX_QA_PLATFORM=web", "YNX_QA_PUBLIC_KEY="+string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})), "YNX_QA_STATE_PATH="+filepath.Join(stateDirectory, "authority"))
			out, err := cmd.StdoutPipe()
			if err != nil {
				t.Fatal(err)
			}
			var diagnostic bytes.Buffer
			cmd.Stderr = &diagnostic
			if err = cmd.Start(); err != nil {
				t.Fatal(err)
			}
			defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
			scanner := bufio.NewScanner(out)
			scanner.Buffer(make([]byte, 4096), 1<<20)
			if !scanner.Scan() {
				_ = cmd.Wait()
				t.Fatal("actual authority startup", diagnostic.String())
			}
			var ready struct {
				URL             string
				Session         productsessionv2.Session
				Initial, Revoke string
			}
			if json.Unmarshal(scanner.Bytes(), &ready) != nil {
				t.Fatal("private startup shape")
			}
			session := ready.Session
			endpoint, err := url.Parse(ready.URL)
			if err != nil || endpoint.Hostname() != "127.0.0.1" {
				t.Fatal("not loopback")
			}
			scope, path, body := "video:library", "/v1/playlists", `{"Name":"Combined own library"}`
			if product == "creator-studio" {
				scope, path, body = "creator:publish", "/v1/channels", `{"Handle":"combined-own","Name":"Combined own channel"}`
			}
			var combined, separate, authorizations atomic.Int32
			var changed, cancelAfter, changeAfter atomic.Bool
			requestCtx, requestCancel := context.WithCancel(ctx)
			defer requestCancel()
			owned, _ := fixture(t, func(cfg *Config) { cfg.Now = time.Now })
			emptyConfig := owned.cfg
			emptyConfig.Root = t.TempDir()
			owned, err = NewService(emptyConfig)
			if err != nil {
				t.Fatal(err)
			}
			transport := mediaSDKRoundTrip(func(r *http.Request) (*http.Response, error) {
				if r.URL.Host != "wallet-auth.ynxweb4.com" {
					return nil, errors.New("wrong authority")
				}
				switch r.URL.Path {
				case "/v2/product-sessions/introspect":
					authorizations.Add(1)
				case "/v2/browser-sessions/introspect", "/v2/browser-sessions/product-revalidate":
					separate.Add(1)
				case "/v2/browser-sessions/product-browser-revalidate":
					combined.Add(1)
					if !owned.store.mu.TryLock() {
						t.Error("remote combined read under original Store lock")
					} else {
						owned.store.mu.Unlock()
					}
				}
				copy := r.Clone(r.Context())
				u := *r.URL
				u.Scheme, u.Host = endpoint.Scheme, endpoint.Host
				copy.URL = &u
				response, e := http.DefaultTransport.RoundTrip(copy)
				if r.URL.Path == "/v2/browser-sessions/product-browser-revalidate" {
					if cancelAfter.Load() {
						requestCancel()
					}
					if changeAfter.Load() {
						changed.Store(true)
					}
				}
				return response, e
			})
			client, err := productsessionv2.NewClient("https://wallet-auth.ynxweb4.com", productsessionv2.Policy{ProductID: product, ClientID: session.ClientID, Platform: "web", ApplicationID: session.ApplicationID, Origin: session.Origin, Callback: session.Callback, AllowedScopes: session.Scopes}, transport)
			if err != nil {
				t.Fatal(err)
			}
			reader, err := productsessionv2.NewPrivateBusinessRevalidator(client, session.ClientID+"-business-web-v1", "qa", key)
			if err != nil {
				t.Fatal(err)
			}
			set, err := productsessionv2.NewRegisteredClientSet(product, []*productsessionv2.Client{client}, []*productsessionv2.Revalidator{reader})
			if err != nil {
				t.Fatal(err)
			}
			cookieKey := make([]byte, 32)
			if _, err = rand.Read(cookieKey); err != nil {
				t.Fatal(err)
			}
			target := "playlists"
			if product == "creator-studio" {
				target = "overview"
			}
			browser, err := productsessionv2.NewBrowserSSO(product, "https://wallet-auth.ynxweb4.com", cookieKey, []string{target}, transport)
			if err != nil {
				t.Fatal(err)
			}
			start := httptest.NewRecorder()
			browser.Start(start, httptest.NewRequest("GET", session.Origin+"/sso/start?target="+target, nil))
			location, err := url.Parse(start.Header().Get("Location"))
			if err != nil || start.Code != 303 {
				t.Fatal("actual Start")
			}
			initiator := map[string]string{}
			for name, values := range location.Query() {
				if len(values) == 1 {
					initiator[name] = values[0]
				}
			}
			qa := func(path string, input any) []byte {
				t.Helper()
				raw, _ := json.Marshal(input)
				r, e := http.Post(ready.URL+path, "application/json", bytes.NewReader(raw))
				if e != nil {
					t.Fatal(e)
				}
				defer r.Body.Close()
				b, _ := io.ReadAll(r.Body)
				if r.StatusCode != 200 {
					t.Fatal("QA command rejected", path, r.StatusCode)
				}
				return b
			}
			var redirect struct {
				RedirectURI string `json:"redirectUri"`
			}
			if json.Unmarshal(qa("/__qa/authorize", initiator), &redirect) != nil || redirect.RedirectURI == "" {
				t.Fatal("actual browser authorize")
			}
			callback := httptest.NewRequest("GET", redirect.RedirectURI, nil)
			for _, cookie := range start.Result().Cookies() {
				callback.AddCookie(cookie)
			}
			completed := httptest.NewRecorder()
			browser.Callback(completed, callback)
			if completed.Code != 303 || completed.Header().Get("Location") != "/#"+target {
				t.Fatal("actual original browser callback", completed.Code)
			}
			request := httptest.NewRequest("POST", session.Origin+path, strings.NewReader(body)).WithContext(requestCtx)
			for _, cookie := range completed.Result().Cookies() {
				if strings.HasSuffix(cookie.Name, "-identity") {
					request.AddCookie(cookie)
				}
			}
			_, original, err := browser.Binding(request)
			if err != nil {
				t.Fatal("original sealed binding")
			}
			request.Header.Set("Origin", session.Origin)
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-YNX-SSO-CSRF", original.CSRF)
			request.Header.Set(productSessionProofV2Header, ready.Initial)
			device := bytes.Repeat([]byte{3}, 32)
			d := new(big.Int).SetBytes(device)
			x, y := elliptic.P256().ScalarBaseMult(device)
			deviceKey := &ecdsa.PrivateKey{PublicKey: ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}, D: d}
			request.Header.Set(videoActionProofHeader, mediaSDKProof(t, session, deviceKey, request.Method, path, body, "combined_original_action_00000001", 25*time.Second, time.Now()))
			// Exercise the shipped JS browser consumer with the actual Go identity
			// response, then use its original CSRF/private headers in this real handler.
			accountRequest := httptest.NewRequest("GET", session.Origin+"/api/sso/account", nil)
			for _, cookie := range request.Cookies() {
				accountRequest.AddCookie(cookie)
			}
			accountResult := httptest.NewRecorder()
			browser.Account(accountResult, accountRequest)
			if accountResult.Code != 200 {
				t.Fatal("actual browser account read")
			}
			frontendIdentityReads := separate.Load()
			if frontendIdentityReads != 1 {
				t.Fatal("one original UI identity/CSRF read required")
			}
			consumerInput, err := json.Marshal(map[string]any{
				"productId": product, "session": session, "accountBody": accountResult.Body.String(),
				"accountHeaders": map[string]string{"content-type": accountResult.Header().Get("Content-Type"), "cache-control": accountResult.Header().Get("Cache-Control")},
				"headers":        map[string]string{productSessionProofV2Header: request.Header.Get(productSessionProofV2Header), videoActionProofHeader: request.Header.Get(videoActionProofHeader)}, "expectedCSRF": original.CSRF,
			})
			if err != nil {
				t.Fatal("bounded original consumer input")
			}
			consumer := exec.CommandContext(ctx, "node", "testdata/media-browser-binding-consumer.mjs")
			consumer.Stdin = bytes.NewReader(consumerInput)
			consumerOutput, err := consumer.Output()
			if err != nil {
				t.Fatal("actual shipped browser consumer rejected Go identity contract", err)
			}
			var consumerHeaders map[string]string
			if json.Unmarshal(consumerOutput, &consumerHeaders) != nil || len(consumerHeaders) != 3 || consumerHeaders["X-YNX-SSO-CSRF"] != original.CSRF || consumerHeaders[productSessionProofV2Header] != request.Header.Get(productSessionProofV2Header) || consumerHeaders[videoActionProofHeader] != request.Header.Get(videoActionProofHeader) {
				t.Fatal("original consumer proof or CSRF changed")
			}
			for name, value := range consumerHeaders {
				request.Header.Set(name, value)
			}
			bind := func(_ context.Context, _ *http.Request, s productsessionv2.Session, b productsessionv2.BrowserGrant) (func(context.Context) error, error) {
				if !reflect.DeepEqual(s, session) || !reflect.DeepEqual(b, original) {
					return nil, ErrUnauthorized
				}
				// Mutating callback copies must not change either original SDK association.
				s.Scopes[0] = "identity:read"
				b.Scopes[0] = "not-a-private-role"
				return func(c context.Context) error {
					if changed.Load() {
						return ErrUnauthorized
					}
					return c.Err()
				}, nil
			}
			authority, err := NewVideoCombinedSDKAuthority(set, set, browser, browser, bind)
			if err != nil {
				t.Fatal(err)
			}
			for _, failure := range []string{"csrf", "origin", "duplicate-csrf", "no-cookie"} {
				bad := request.Clone(requestCtx)
				bad.Header = request.Header.Clone()
				switch failure {
				case "csrf":
					bad.Header.Set("X-YNX-SSO-CSRF", "wrong")
				case "origin":
					bad.Header.Set("Origin", "https://foreign.invalid")
				case "duplicate-csrf":
					bad.Header.Add("X-YNX-SSO-CSRF", original.CSRF)
				case "no-cookie":
					bad.Header.Del("Cookie")
				}
				if _, e := authority.VerifyVideoBusiness(requestCtx, bad, scope, strings.NewReader(body), int64(len(body))); e == nil {
					t.Fatal("accepted", failure)
				}
			}
			if authorizations.Load() != 0 || combined.Load() != 0 || separate.Load() != frontendIdentityReads {
				t.Fatal("HTTP binding failures reached authority")
			}
			grant, err := authority.VerifyVideoBusiness(requestCtx, request, scope, strings.NewReader(body), int64(len(body)))
			if err != nil {
				t.Fatal("original SDK authorize", err)
			}
			if !grant.SessionExpiresAt.Equal(mustMediaTime(t, session.ExpiresAt)) {
				t.Fatal("private expiry relabeled from browser")
			}
			before, err := os.ReadFile(owned.store.statePath)
			if err != nil {
				t.Fatal(err)
			}
			// Cancellation after the real response arrives is a 503 hold, with zero effect.
			cancelAfter.Store(true)
			if e := grant.Revalidate(requestCtx); !errors.Is(e, ErrVideoAuthorityUnavailable) {
				t.Fatal("canceled same-decision read not held", e)
			}
			cancelAfter.Store(false)
			if b, _ := os.ReadFile(owned.store.statePath); !bytes.Equal(before, b) {
				t.Fatal("canceled read changed Store")
			}
			changeAfter.Store(true)
			if e := grant.Revalidate(ctx); e == nil || videoBusinessErrorStatus(e) != 401 {
				t.Fatal("late original actor change survived remote await", e)
			}
			changeAfter.Store(false)
			changed.Store(false)
			if b, _ := os.ReadFile(owned.store.statePath); !bytes.Equal(before, b) {
				t.Fatal("late actor change affected original Store")
			}
			// The identical original association can still be retried explicitly; no renewal.
			scoped, err := owned.withBusinessGrant(ctx, grant, false)
			if err != nil {
				t.Fatal("combined original admission", err)
			}
			// The original store and service must perform the real private effect.
			var channelID string
			if product == "video" {
				if _, err = scoped.CreatePlaylist(session.Account, "Combined own library"); err != nil {
					t.Fatal(err)
				}
			} else {
				channel, e := scoped.EnsureChannel(session.Account, "combined-own", "Combined own channel")
				if e != nil {
					t.Fatal(e)
				}
				channelID = channel.ID
			}
			cold, e := NewService(owned.cfg)
			if e != nil {
				t.Fatal(e)
			}
			if product == "video" {
				lists, e := cold.Playlists(session.Account)
				if e != nil || len(lists) != 1 || lists[0].Name != "Combined own library" {
					t.Fatal("cold own playlist readback", e)
				}
				foreign, e := cold.Playlists(testAttackerAccount)
				if e != nil || len(foreign) != 0 {
					t.Fatal("cross-account cold list exposure", e)
				}
			} else {
				channel, e := cold.Channel(session.Account, channelID)
				if e != nil || channel.Channel.Owner != session.Account || channel.Channel.Name != "Combined own channel" {
					t.Fatal("cold own creator channel readback", e)
				}
			}
			after, _ := os.ReadFile(owned.store.statePath)
			if bytes.Equal(before, after) {
				t.Fatal("no original private effect")
			}
			changed.Store(true)
			calls := combined.Load()
			if grant.Revalidate(ctx) == nil || combined.Load() != calls {
				t.Fatal("local generation veto reached remote")
			}
			changed.Store(false)
			qa("/__qa/outage", map[string]any{})
			if e := grant.Revalidate(ctx); !errors.Is(e, ErrVideoAuthorityUnavailable) {
				t.Fatal("outage not held", e)
			}
			// Exercise actual HTTP response classification without creating another grant.
			owned.cfg.BusinessAuthority = videoAuthorityFunc(func(context.Context, *http.Request, string, io.Reader, int64) (VideoBusinessGrant, error) {
				return grant, nil
			})
			held := httptest.NewRecorder()
			NewServer(owned, StaticTokenAuth{}).Handler().ServeHTTP(held, request.Clone(ctx))
			if held.Code != 503 {
				t.Fatal("outage became logout/401", held.Code)
			}
			if b, _ := os.ReadFile(owned.store.statePath); !bytes.Equal(after, b) {
				t.Fatal("outage changed original Store")
			}
			// Outage mode is reset only through an explicit QA command, never product retry.
			qa("/__qa/normal", map[string]any{})
			if revokeKind == "browser" {
				qa("/__qa/browser-revoke", map[string]any{})
			} else {
				rev, e := http.NewRequest("POST", ready.URL+"/v2/product-sessions/revoke", strings.NewReader("{}"))
				if e != nil {
					t.Fatal(e)
				}
				rev.Header.Set("Content-Type", "application/json")
				rev.Header.Set("X-Request-Id", "req_media_combined_private_revoke")
				rev.Header.Set(productSessionProofV2Header, ready.Revoke)
				response, e := http.DefaultClient.Do(rev)
				if e != nil {
					t.Fatal(e)
				}
				io.Copy(io.Discard, response.Body)
				response.Body.Close()
				if response.StatusCode != 200 {
					t.Fatal("actual private revoke", response.StatusCode)
				}
			}
			if e := grant.Revalidate(ctx); e == nil || videoBusinessErrorStatus(e) != 401 {
				t.Fatal("original "+revokeKind+" revoke stayed authorized", e)
			}
			if b, _ := os.ReadFile(owned.store.statePath); !bytes.Equal(after, b) {
				t.Fatal("revocation changed original Store")
			}

			if separate.Load() != frontendIdentityReads || combined.Load() < 3 {
				t.Fatal("combined read split into independent awaits")
			}
			t.Log("actual sealed PKCE callback; full original same-decision Session+BrowserGrant; original private Store; cancellation and outage hold; local generation veto; no separate identity/private read")
		})
	}
}
func mustMediaTime(t *testing.T, value string) time.Time {
	t.Helper()
	v, e := time.Parse(time.RFC3339Nano, value)
	if e != nil {
		t.Fatal(e)
	}
	return v
}
