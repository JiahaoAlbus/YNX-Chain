package video

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Trusted fixture verifier exercises the original HTTP/storage boundary. It
// cannot substitute for the shared owner's cryptographic SDK installation.
type videoAuthorityFunc func(context.Context, *http.Request, string, io.Reader, int64) (VideoBusinessGrant, error)

func (f videoAuthorityFunc) VerifyVideoBusiness(c context.Context, r *http.Request, s string, b io.Reader, n int64) (VideoBusinessGrant, error) {
	return f(c, r, s, b, n)
}
func videoHTTPFixture(t *testing.T) (*Service, http.Handler, videoSessionV2, *atomic.Int32) {
	t.Helper()
	var count atomic.Int32
	s, _ := fixture(t, nil)
	claim := creatorV2Fixture()
	claim.ProductID = "video"
	claim.ClientID = "ynx-video-mobile-v1"
	claim.ApplicationID = "com.ynxweb4.video.web"
	claim.Origin = "https://video.ynxweb4.com"
	claim.Callback = claim.Origin + "/wallet-auth/callback"
	claim.Scopes = []string{"video:library", "video:account", "video:playback"}
	claim.ExpiresAt = s.cfg.Now().Add(time.Minute).Format(time.RFC3339Nano)
	s.cfg.BusinessAuthority = videoAuthorityFunc(func(ctx context.Context, r *http.Request, scope string, b io.Reader, n int64) (VideoBusinessGrant, error) {
		count.Add(1)
		raw, err := io.ReadAll(b)
		if err != nil {
			return VideoBusinessGrant{}, err
		}
		if int64(len(raw)) != n {
			t.Error("incomplete verifier body")
		}
		sum := sha256.Sum256(raw)
		return VideoBusinessGrant{Actor: claim.Account, ProductID: claim.ProductID, Scope: scope, Nonce: r.Header.Get(videoActionProofHeader), BodyDigest: hex.EncodeToString(sum[:]), SessionBinding: claim.SessionBinding, ExpiresAt: s.cfg.Now().Add(time.Minute), SessionExpiresAt: s.cfg.Now().Add(time.Minute), Revalidate: func(context.Context) error { return nil }}, nil
	})
	return s, NewServer(s, StaticTokenAuth{Tokens: map[string]string{"legacy": "ynx1owner"}}).Handler(), claim, &count
}
func videoCanonicalRequest(claim videoSessionV2, method, path, body, nonce string) *http.Request {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set(productSessionProofV2Header, encodedV2Fixture(claim))
	r.Header.Set(videoActionProofHeader, nonce)
	r.Header.Set("Origin", claim.Origin)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Idempotency-Key", nonce)
	return r
}
func TestVideoBusinessHTTPOriginalLibraryAndDurableReplay(t *testing.T) {
	s, h, claim, _ := videoHTTPFixture(t)
	request := func(method, path, body, nonce string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, videoCanonicalRequest(claim, method, path, body, nonce))
		return w
	}
	w := request("POST", "/v1/playlists", `{"Name":"Original canonical list"}`, "http_original_nonce_00001")
	if w.Code != 200 {
		t.Fatalf("create %d %s", w.Code, w.Body.String())
	}
	lists, err := s.Playlists(claim.Account)
	if err != nil || len(lists) != 1 || lists[0].Name != "Original canonical list" {
		t.Fatalf("original library %v %v", lists, err)
	}
	before, _ := os.ReadFile(s.store.statePath)
	w = request("POST", "/v1/playlists", `{"Name":"Replay"}`, "http_original_nonce_00001")
	if w.Code < 400 {
		t.Fatal("replayed business committed")
	}
	after, _ := os.ReadFile(s.store.statePath)
	if !bytes.Equal(before, after) {
		t.Fatal("replay changed stored state")
	}
	w = request("GET", "/v1/account", "", "http_account_nonce_000001")
	if w.Code != 200 || !strings.Contains(w.Body.String(), claim.Account) || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("readback %d %s", w.Code, w.Body.String())
	}
	w = request("GET", "/v1/playlists", "", "http_library_nonce_000001")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Original canonical list") {
		t.Fatal("private library missing")
	}
	if files, _ := filepath.Glob(filepath.Join(s.store.root, ".video-business-wire-*")); len(files) != 0 {
		t.Fatal("wire files retained")
	}
}
func TestVideoBusinessHTTPRejectsAmbiguityAndFailedDecode(t *testing.T) {
	for _, kind := range []string{"duplicate-session", "duplicate-action", "duplicate-origin", "mixed-legacy", "query", "get-body", "oversize", "malformed"} {
		t.Run(kind, func(t *testing.T) {
			s, h, claim, count := videoHTTPFixture(t)
			r := videoCanonicalRequest(claim, "POST", "/v1/playlists", `{"Name":"Rejected"}`, "http_invalid_nonce_000001")
			switch kind {
			case "duplicate-session":
				r.Header.Add(productSessionProofV2Header, r.Header.Get(productSessionProofV2Header))
			case "duplicate-action":
				r.Header.Add(videoActionProofHeader, "second_nonce_0000001")
			case "duplicate-origin":
				r.Header.Add("Origin", claim.Origin)
			case "mixed-legacy":
				r.Header.Set("Authorization", "Bearer legacy")
			case "query":
				r.URL.RawQuery = "x=1"
			case "get-body":
				r.Method = "GET"
				r.URL.Path = "/v1/account"
			case "oversize":
				r.ContentLength = (1 << 20) + 1
			case "malformed":
				r.Body = io.NopCloser(strings.NewReader(`{"Name":"Rejected"} trailing`))
				r.ContentLength = -1
			}
			before, _ := os.ReadFile(s.store.statePath)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code < 400 {
				t.Fatalf("accepted %d", w.Code)
			}
			after, _ := os.ReadFile(s.store.statePath)
			if !bytes.Equal(before, after) || len(s.store.state.BusinessNonces) != 0 {
				t.Fatal("failure consumed nonce or changed original store")
			}
			if kind != "malformed" && count.Load() != 0 {
				t.Fatal("invalid request reached verifier")
			}
		})
	}
}
func TestVideoBusinessHTTPConfiguredAuthorityNoLegacyFallback(t *testing.T) {
	_, h, claim, count := videoHTTPFixture(t)
	r := httptest.NewRequest("GET", "/v1/account", nil)
	r.Header.Set("Authorization", "Bearer legacy")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 401 || count.Load() != 0 {
		t.Fatal("legacy fallback admitted")
	}
	s, _ := fixture(t, nil)
	w = httptest.NewRecorder()
	NewServer(s, StaticTokenAuth{}).Handler().ServeHTTP(w, videoCanonicalRequest(claim, "GET", "/v1/account", "", "http_nil_authority_00001"))
	if w.Code != 503 {
		t.Fatal("canonical accepted without trusted factory")
	}
}

type videoWaitingBody struct {
	release chan struct{}
	entered chan struct{}
}

func (b *videoWaitingBody) Read([]byte) (int, error) { close(b.entered); <-b.release; return 0, io.EOF }
func (b *videoWaitingBody) Close() error             { return nil }
func TestVideoBusinessHTTPBodyCancellationSettles(t *testing.T) {
	s, h, claim, count := videoHTTPFixture(t)
	r := videoCanonicalRequest(claim, "POST", "/v1/playlists", "", "http_body_cancel_0000001")
	body := &videoWaitingBody{make(chan struct{}), make(chan struct{})}
	r.Body = body
	r.ContentLength = -1
	ctx, cancel := context.WithCancel(r.Context())
	r = r.WithContext(ctx)
	done := make(chan struct{})
	w := httptest.NewRecorder()
	go func() { h.ServeHTTP(w, r); close(done) }()
	<-body.entered
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("canceled body stalled handler")
	}
	close(body.release)
	if w.Code < 400 || count.Load() != 0 || len(s.store.state.BusinessNonces) != 0 {
		t.Fatal("canceled body admitted")
	}
}
func TestVideoBusinessHTTPVerifierMismatchAndRevocation(t *testing.T) {
	for _, kind := range []string{"digest", "scope", "account", "session", "expiry", "revoked"} {
		t.Run(kind, func(t *testing.T) {
			s, _, claim, _ := videoHTTPFixture(t)
			base := s.cfg.BusinessAuthority
			s.cfg.BusinessAuthority = videoAuthorityFunc(func(c context.Context, r *http.Request, scope string, b io.Reader, n int64) (VideoBusinessGrant, error) {
				g, e := base.VerifyVideoBusiness(c, r, scope, b, n)
				switch kind {
				case "digest":
					g.BodyDigest = strings.Repeat("a", 64)
				case "scope":
					g.Scope = "video:playback"
				case "account":
					g.Actor = "ynx1wrong"
				case "session":
					g.SessionBinding = "wrong"
				case "expiry":
					g.ExpiresAt = g.ExpiresAt.Add(time.Second)
				case "revoked":
					g.Revalidate = func(context.Context) error { return ErrUnauthorized }
				}
				return g, e
			})
			w := httptest.NewRecorder()
			NewServer(s, StaticTokenAuth{}).Handler().ServeHTTP(w, videoCanonicalRequest(claim, "POST", "/v1/playlists", `{"Name":"Rejected"}`, fmt.Sprintf("http_mismatch_%s_000001", kind)))
			if w.Code != 401 || len(s.store.state.BusinessNonces) != 0 {
				t.Fatalf("mismatch accepted: %d", w.Code)
			}
		})
	}
}

func TestVideoBusinessHTTPFreshProofKeepsOriginalIdempotency(t *testing.T) {
	s, h, claim, _ := videoHTTPFixture(t)
	run := func(nonce string) *httptest.ResponseRecorder {
		r := videoCanonicalRequest(claim, "POST", "/v1/playlists", `{"Name":"One retained intent"}`, nonce)
		r.Header.Set("Idempotency-Key", "original_stable_intent_00001")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	first := run("http_fresh_proof_nonce_001")
	second := run("http_fresh_proof_nonce_002")
	if first.Code != 200 || second.Code != 200 || first.Body.String() != second.Body.String() {
		t.Fatalf("fresh proof retry lost original receipt %d %d", first.Code, second.Code)
	}
	lists, _ := s.Playlists(claim.Account)
	if len(lists) != 1 || len(s.store.state.BusinessNonces) != 2 {
		t.Fatal("retry duplicated original business or reused nonce")
	}
	restarted, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	r := videoCanonicalRequest(claim, "POST", "/v1/playlists", `{"Name":"One retained intent"}`, "http_fresh_proof_nonce_001")
	r.Header.Set("Idempotency-Key", "original_stable_intent_00001")
	NewServer(restarted, StaticTokenAuth{}).Handler().ServeHTTP(w, r)
	if w.Code < 400 {
		t.Fatal("restart allowed proof replay")
	}
}

func TestVideoMatureProofMetadataHasNoPlatformAndSeparateSessionExpiry(t *testing.T) {
	for _, platform := range []string{"web", "android", "macos"} {
		t.Run(platform, func(t *testing.T) {
			s, h, claim, _ := videoHTTPFixture(t)
			if platform == "android" {
				claim.ApplicationID = "com.ynxweb4.video"
				claim.Origin = "app://android/com.ynxweb4.video"
				claim.Callback = "ynxvideo://wallet-auth/callback"
				claim.PackageID = &claim.ApplicationID
			}
			if platform == "macos" {
				claim.ApplicationID = "com.ynxweb4.video"
				claim.Origin = "app://macos/com.ynxweb4.video"
				claim.Callback = "ynxvideo://wallet-auth/callback"
				claim.BundleID = &claim.ApplicationID
			}
			claim.Platform = ""
			claim.ExpiresAt = s.cfg.Now().Add(15 * time.Second).Format(time.RFC3339Nano)
			r := videoCanonicalRequest(claim, "GET", "/v1/account", "", "mature_metadata_nonce_001")
			var original map[string]any
			raw, _ := base64.RawURLEncoding.DecodeString(r.Header.Get(productSessionProofV2Header))
			if e := json.Unmarshal(raw, &original); e != nil {
				t.Fatal(e)
			}
			delete(original, "platform")
			delete(original, "chainId")
			raw, _ = json.Marshal(original)
			r.Header.Set(productSessionProofV2Header, base64.RawURLEncoding.EncodeToString(raw))
			routed, scope, e := videoBusinessRequestScope(r)
			if e != nil || routed.Platform != platform || scope != "video:account" {
				t.Fatalf("original full tuple not inferred: %s %v", routed.Platform, e)
			}
			// The trusted fixture models separately verified action expiry and the full
			// session expiry. This is metadata/consumer evidence, not cryptographic QA.
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != 200 {
				t.Fatalf("valid action later than introspection expiry rejected %d %s", w.Code, w.Body.String())
			}
		})
	}
}
func TestVideoBusinessMissingOriginalSessionExpiryFailsClosed(t *testing.T) {
	s, _, claim, _ := videoHTTPFixture(t)
	base := s.cfg.BusinessAuthority
	s.cfg.BusinessAuthority = videoAuthorityFunc(func(c context.Context, r *http.Request, scope string, b io.Reader, n int64) (VideoBusinessGrant, error) {
		g, e := base.VerifyVideoBusiness(c, r, scope, b, n)
		g.SessionExpiresAt = time.Time{}
		return g, e
	})
	w := httptest.NewRecorder()
	NewServer(s, StaticTokenAuth{}).Handler().ServeHTTP(w, videoCanonicalRequest(claim, "GET", "/v1/account", "", "missing_original_expiry_001"))
	if w.Code != 401 || len(s.store.state.BusinessNonces) != 0 {
		t.Fatal("reduced grant accepted without full original session expiry")
	}
}
