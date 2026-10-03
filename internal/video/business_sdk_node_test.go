//go:build ynx_canonical_media

package video

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
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

	"github.com/JiahaoAlbus/YNX-Chain/internal/music"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// This exercises the actual frozen Node control authority and SDK over loopback
// with disposable approval/device/backend keys. It is not real Wallet consent,
// Central Web identity/CSRF, OS-device enrollment or deployed product acceptance.
func TestMediaActualFrozenNodeAuthorityAndOriginalHTTPStore(t *testing.T) {
	source := os.Getenv("YNX_QA_CENTRAL_SOURCE")
	if source == "" {
		t.Skip("requires explicit SHA-verified frozen Central fixture package")
	}
	cases := [][2]string{{"video", "web"}, {"video", "android"}, {"video", "macos"}, {"creator-studio", "web"}, {"creator-studio", "android"}, {"creator-studio", "macos"}, {"music", "android"}, {"music", "ios"}, {"music", "web"}, {"music", "macos"}}
	for _, tc := range cases {
		t.Run(tc[0]+"/"+tc[1], func(t *testing.T) {
			product, platform := tc[0], tc[1]
			public, key, e := ed25519.GenerateKey(rand.Reader)
			if e != nil {
				t.Fatal(e)
			}
			der, e := x509.MarshalPKIXPublicKey(public)
			if e != nil {
				t.Fatal(e)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
			defer cancel()
			stateDirectory := t.TempDir()
			if e = os.Chmod(stateDirectory, 0700); e != nil {
				t.Fatal(e)
			}
			cmd := exec.CommandContext(ctx, "node", "testdata/media-private-authority-node.mjs")
			cmd.Env = append(os.Environ(), "YNX_QA_CENTRAL_SOURCE="+source, "YNX_QA_PRODUCT_ID="+product, "YNX_QA_PLATFORM="+platform, "YNX_QA_PUBLIC_KEY="+string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})), "YNX_QA_STATE_PATH="+filepath.Join(stateDirectory, "authority"))
			output, e := cmd.StdoutPipe()
			if e != nil {
				t.Fatal(e)
			}
			input, e := cmd.StdinPipe()
			if e != nil {
				t.Fatal(e)
			}
			var diagnostic bytes.Buffer
			cmd.Stderr = &diagnostic
			if e = cmd.Start(); e != nil {
				t.Fatal(e)
			}
			defer func() { input.Close(); _ = cmd.Process.Kill(); _ = cmd.Wait() }()
			scanner := bufio.NewScanner(output)
			scanner.Buffer(make([]byte, 4096), 1<<20)
			var ready struct {
				URL         string                   `json:"url"`
				Session     productsessionv2.Session `json:"session"`
				Unsupported bool                     `json:"unsupported"`
				Code        string                   `json:"code"`
			}
			if !scanner.Scan() {
				t.Fatal("actual Node authority failed startup", diagnostic.String())
			}
			if e = json.Unmarshal(scanner.Bytes(), &ready); e != nil {
				t.Fatal("invalid private startup shape")
			}
			if product == "music" && (platform == "web" || platform == "macos") && os.Getenv("YNX_QA_MEDIA_MUSIC_EXTENDED") != "1" {
				if !ready.Unsupported || ready.Code == "" {
					t.Fatal("unregistered Music platform accepted by real registry")
				}
				if _, e = os.Stat(filepath.Join(stateDirectory, "authority")); !os.IsNotExist(e) {
					t.Fatal("unsupported platform created an authority state")
				}
				t.Log("actual frozen registry rejects unregistered Music platform before approval/enrollment")
				return
			}
			if ready.Unsupported {
				t.Fatal("registered Media tuple rejected", ready.Code)
			}
			s := ready.Session
			if s.ProductID != product || s.Platform != platform || len(s.Scopes) < 3 {
				t.Fatal("actual authority returned wrong product/platform/scope")
			}
			if product == "music" && platform != "web" && s.Callback != "ynxmusic://auth/callback" {
				t.Fatal("actual registered Music callback changed")
			}
			endpoint, e := url.Parse(ready.URL)
			if e != nil || endpoint.Hostname() != "127.0.0.1" || endpoint.Scheme != "http" {
				t.Fatal("QA authority is not loopback")
			}
			var checkUnlocked func() bool
			var initialCalls, readerCalls atomic.Int32
			transport := mediaSDKRoundTrip(func(r *http.Request) (*http.Response, error) {
				if r.URL.Host != "wallet-auth.ynxweb4.com" {
					t.Fatal("SDK endpoint changed")
				}
				if r.URL.Path == "/v2/product-sessions/introspect" {
					initialCalls.Add(1)
				}
				if r.URL.Path == "/v2/browser-sessions/product-revalidate" {
					readerCalls.Add(1)
					if checkUnlocked != nil && !checkUnlocked() {
						t.Fatal("actual Node read while original product mutex held")
					}
				}
				copy := r.Clone(r.Context())
				u := *r.URL
				u.Scheme = endpoint.Scheme
				u.Host = endpoint.Host
				copy.URL = &u
				return http.DefaultTransport.RoundTrip(copy)
			})
			client, e := productsessionv2.NewClient("https://wallet-auth.ynxweb4.com", productsessionv2.Policy{ProductID: s.ProductID, ClientID: s.ClientID, Platform: s.Platform, ApplicationID: s.ApplicationID, Origin: s.Origin, Callback: s.Callback, BundleID: s.BundleID, PackageID: s.PackageID, AllowedScopes: s.Scopes}, transport)
			if e != nil {
				t.Fatal(e)
			}
			reader, e := productsessionv2.NewPrivateBusinessRevalidator(client, s.ClientID+"-business-"+s.Platform+"-v1", "media-qa", key)
			if e != nil {
				t.Fatal(e)
			}
			set, e := productsessionv2.NewRegisteredClientSet(product, []*productsessionv2.Client{client}, []*productsessionv2.Revalidator{reader})
			if e != nil {
				t.Fatal(e)
			}
			var currentChanged atomic.Bool
			bind := func(_ context.Context, _ *http.Request, session productsessionv2.Session) (func(context.Context) error, error) {
				if !reflect.DeepEqual(session, s) {
					return nil, ErrUnauthorized
				}
				return func(ctx context.Context) error {
					if ctx.Err() != nil || currentChanged.Load() {
						return ErrUnauthorized
					}
					return nil
				}, nil
			}
			var handler http.Handler
			var revalidate func(context.Context) error
			var stateBytes func() []byte
			var playlistCount func() int
			var restart func() error
			path, body, actionHeader := "/v1/playlists", "{\n \"Name\": \"Node original library\" }\n", videoActionProofHeader
			expected, rejected := 200, 409
			if product == "music" {
				authority, e := music.NewMusicSDKAuthority(set, music.BindMusicCurrentActor(bind))
				if e != nil {
					t.Fatal(e)
				}
				cfg := music.Config{StatePath: filepath.Join(t.TempDir(), "state.json"), MediaDir: t.TempDir(), MaxUploadBytes: 1 << 20, Now: time.Now}
				owned, e := music.New(cfg)
				if e != nil {
					t.Fatal(e)
				}
				// The original Music store is private to its package. SDK fixture tests in
				// that package independently assert TryLock; this checks original readback.
				checkUnlocked = nil
				cfg.BusinessAuthority = mediaNodeMusicAuthority{base: authority, capture: func(g music.MusicBusinessGrant) { revalidate = g.Revalidate }}
				owned, e = music.New(cfg)
				if e != nil {
					t.Fatal(e)
				}
				handler = music.NewServer(owned, "", nil).Handler()
				stateBytes = func() []byte { b, _ := os.ReadFile(cfg.StatePath); return b }
				playlistCount = func() int {
					v := owned.Playlists(s.Account)
					return len(v)
				}
				restart = func() error {
					var e error
					owned, e = music.New(cfg)
					if e == nil {
						handler = music.NewServer(owned, "", nil).Handler()
					}
					return e
				}
				path, body, actionHeader = "/api/playlists", "{\n \"name\": \"Node original library\", \"trackIds\": [] }\n", "X-YNX-Music-Business-Proof-V2"
				expected, rejected = 201, 401
			} else {
				authority, e := NewVideoSDKAuthority(set, set, bind)
				if e != nil {
					t.Fatal(e)
				}
				owned, _ := fixture(t, func(cfg *Config) { cfg.Now = time.Now })
				owned.cfg.BusinessAuthority = videoAuthorityFunc(func(ctx context.Context, r *http.Request, scope string, b io.Reader, n int64) (VideoBusinessGrant, error) {
					g, e := authority.VerifyVideoBusiness(ctx, r, scope, b, n)
					if e == nil {
						revalidate = g.Revalidate
					}
					return g, e
				})
				handler = NewServer(owned, StaticTokenAuth{}).Handler()
				checkUnlocked = func() bool {
					if !owned.store.mu.TryLock() {
						return false
					}
					owned.store.mu.Unlock()
					return true
				}
				stateBytes = func() []byte { b, _ := os.ReadFile(owned.store.statePath); return b }
				playlistCount = func() int {
					v, e := owned.Playlists(s.Account)
					if e != nil {
						t.Fatal(e)
					}
					return len(v)
				}
				restart = func() error {
					var e error
					owned, e = NewService(owned.cfg)
					if e == nil {
						handler = NewServer(owned, StaticTokenAuth{}).Handler()
					}
					return e
				}
			}
			type proofs struct{ Initial, Action, Revoke string }
			exchange := func(kind string) proofs {
				t.Helper()
				message := map[string]string{"kind": kind}
				if kind == "proofs" {
					message["bodyBase64"] = base64.StdEncoding.EncodeToString([]byte(body))
				} else if kind == "account" {
					message["kind"] = "proofs"
					message["operation"] = "account"
					message["bodyBase64"] = ""
				}
				if e = json.NewEncoder(input).Encode(message); e != nil {
					t.Fatal("QA command failed")
				}
				if !scanner.Scan() {
					t.Fatal("QA proof generator stopped", diagnostic.String())
				}
				var p proofs
				if json.Unmarshal(scanner.Bytes(), &p) != nil {
					t.Fatal("invalid private proof response")
				}
				return p
			}
			send := func(p proofs, wire, key string) *httptest.ResponseRecorder {
				t.Helper()
				r := httptest.NewRequest("POST", path, strings.NewReader(wire)).WithContext(ctx)
				r.Header.Set("Content-Type", "application/json")
				r.Header.Set("Idempotency-Key", key)
				r.Header.Set(productSessionProofV2Header, p.Initial)
				r.Header.Set(actionHeader, p.Action)
				if platform == "web" {
					r.Header.Set("Origin", s.Origin)
				}
				w := httptest.NewRecorder()
				handler.ServeHTTP(w, r)
				return w
			}
			first := exchange("proofs")
			w := send(first, body, "original-node-playlist")
			if w.Code != expected {
				t.Fatalf("actual Node + SDK original HTTP rejected: %d %s", w.Code, w.Body.String())
			}
			if playlistCount() != 1 || revalidate == nil || readerCalls.Load() == 0 || initialCalls.Load() != 1 {
				t.Fatal("missing original business/readback/confidential reader")
			}
			accountProof := exchange("account")
			accountPath := "/v1/account"
			if product == "music" {
				accountPath = "/api/me"
			}
			accountRequest := httptest.NewRequest("GET", accountPath, nil).WithContext(ctx)
			accountRequest.Header.Set(productSessionProofV2Header, accountProof.Initial)
			accountRequest.Header.Set(actionHeader, accountProof.Action)
			if platform == "web" {
				accountRequest.Header.Set("Origin", s.Origin)
			}
			accountReply := httptest.NewRecorder()
			handler.ServeHTTP(accountReply, accountRequest)
			if accountReply.Code != 200 {
				t.Fatalf("original account readback failed %d %s", accountReply.Code, accountReply.Body.String())
			}
			var accountWire struct {
				Account string `json:"account"`
				Profile struct {
					Account string `json:"account"`
				} `json:"profile"`
			}
			if json.Unmarshal(accountReply.Body.Bytes(), &accountWire) != nil {
				t.Fatal("invalid original account response")
			}
			actualAccount := accountWire.Account
			if product == "music" {
				actualAccount = accountWire.Profile.Account
			}
			if actualAccount != s.Account {
				t.Fatal("real Node session did not return the same original business account")
			}
			before := stateBytes()
			if e = restart(); e != nil {
				t.Fatal(e)
			}
			replay := exchange("proofs")
			replay.Action = first.Action
			w = send(replay, body, "original-node-playlist")
			if w.Code != rejected || playlistCount() != 1 {
				t.Fatalf("restart action replay accepted %d", w.Code)
			}
			// A genuine fresh pair with the same stable original intent returns its
			// retained receipt and never creates another playlist/effect.
			fresh := exchange("proofs")
			w = send(fresh, body, "original-node-playlist")
			if w.Code != expected || playlistCount() != 1 {
				t.Fatalf("fresh proof original recovery failed %d %s", w.Code, w.Body.String())
			}
			currentChanged.Store(true)
			unchanged := stateBytes()
			w = send(exchange("proofs"), body, "changed-actor-cannot-write")
			if w.Code < 400 || !bytes.Equal(unchanged, stateBytes()) || playlistCount() != 1 {
				t.Fatal("changed current actor wrote original store")
			}
			currentChanged.Store(false)
			tampered := exchange("proofs")
			unchanged = stateBytes()
			w = send(tampered, body+" ", "tampered-wire-cannot-write")
			if w.Code < 400 || !bytes.Equal(unchanged, stateBytes()) {
				t.Fatal("actual Node-signed raw body accepted changed wire")
			}
			revoke := exchange("revoke")
			request, e := http.NewRequestWithContext(ctx, "POST", ready.URL+"/v2/product-sessions/revoke", strings.NewReader("{}"))
			if e != nil {
				t.Fatal(e)
			}
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Request-Id", "req_media_qa_revoke")
			request.Header.Set(productSessionProofV2Header, revoke.Revoke)
			if platform == "web" {
				request.Header.Set("Origin", s.Origin)
			}
			response, e := http.DefaultClient.Do(request)
			if e != nil {
				t.Fatal(e)
			}
			_, _ = io.Copy(io.Discard, response.Body)
			response.Body.Close()
			if response.StatusCode != 200 {
				t.Fatal("actual original session revoke failed", response.StatusCode)
			}
			if e = revalidate(ctx); e == nil {
				t.Fatal("actual Node-revoked original full session stayed authorized")
			}
			unchanged = stateBytes()
			w = send(exchange("proofs"), body, "revoked-cannot-write")
			if w.Code < 400 || !bytes.Equal(unchanged, stateBytes()) || playlistCount() != 1 {
				t.Fatal("revoked original session reached business")
			}
			if bytes.Equal(before, stateBytes()) {
				t.Fatal("fresh-proof recovery did not persist its own replay marker")
			}
		})
	}
}

type mediaNodeMusicAuthority struct {
	base    music.MusicBusinessAuthority
	capture func(music.MusicBusinessGrant)
}

func (a mediaNodeMusicAuthority) VerifyMusicBusiness(ctx context.Context, r *http.Request, scope string, b io.Reader, n int64) (music.MusicBusinessGrant, error) {
	g, e := a.base.VerifyMusicBusiness(ctx, r, scope, b, n)
	if e == nil {
		a.capture(g)
	}
	return g, e
}
