package productsessionv2

// Fixed PUBLIC-only test keys exercise the ORIGINAL backend/P256 algorithms.
// They are not production keys, registered devices, Root or session grants.
import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"strings"
	"testing"
	"time"
)

type revalidationCompletionBody struct {
	reader         *bytes.Reader
	atEOF, atClose func()
	closeError     error
}

func (b *revalidationCompletionBody) Read(p []byte) (int, error) {
	n, e := b.reader.Read(p)
	if e == io.EOF && b.atEOF != nil {
		fn := b.atEOF
		b.atEOF = nil
		fn()
	}
	return n, e
}
func (b *revalidationCompletionBody) Close() error {
	if b.atClose != nil {
		fn := b.atClose
		b.atClose = nil
		fn()
	}
	return b.closeError
}

type revalidationFixture struct {
	client        *Client
	r             *Revalidator
	session       Session
	clock         *int64
	calls, clocks *int
	mutate        func(map[string]any)
	after         int64
	cancelOnClose context.CancelFunc
	afterClose    *int64
	closeError    error
	responseClose *bool
}

func revalidationNew(t *testing.T, version string) *revalidationFixture {
	t.Helper()
	x := currentFixtureNew(t, version)
	x.policy.ClientID = "ynx-social-v1"
	x.policy.Origin = "https://social.ynxweb4.com"
	x.policy.Callback = "https://social.ynxweb4.com/wallet-auth/callback"
	for _, m := range []map[string]any{x.session, x.proof} {
		m["clientId"] = x.policy.ClientID
		m["origin"] = x.policy.Origin
		m["callback"] = x.policy.Callback
	}
	var session Session
	if e := json.Unmarshal(currentCanonical(t, x.session), &session); e != nil {
		t.Fatal(e)
	}
	clock := int64(1000)
	calls, clocks := 0, 0
	closed := false
	f := &revalidationFixture{session: session, clock: &clock, calls: &calls, clocks: &clocks, after: 1500, responseClose: &closed}
	key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x51}, ed25519.SeedSize))
	transport := currentRoundTripper(func(req *http.Request) (*http.Response, error) {
		calls++
		raw, e := io.ReadAll(req.Body)
		if e != nil {
			t.Fatal(e)
		}
		body, e := canonicalObject(raw)
		if e != nil {
			t.Fatal(e)
		}
		proofRaw, e := base64.RawURLEncoding.Strict().DecodeString(req.Header.Get("X-YNX-Backend-Proof"))
		if e != nil {
			t.Fatal(e)
		}
		proof, e := canonicalObject(proofRaw)
		if e != nil {
			t.Fatal(e)
		}
		sig, e := base64.RawURLEncoding.Strict().DecodeString(text(proof, "signature"))
		if e != nil {
			t.Fatal(e)
		}
		delete(proof, "signature")
		if !ed25519.Verify(key.Public().(ed25519.PublicKey), currentCanonical(t, proof), sig) {
			t.Fatal("original backend signature changed")
		}
		sum := sha256.Sum256(raw)
		if text(proof, "bodySha256") != hex.EncodeToString(sum[:]) || text(proof, "path") != req.URL.Path || text(proof, "issuedAt") != currentMS(1000) {
			t.Fatal("backend original body/path/one before-clock mismatch")
		}
		if req.URL.Host != "wallet-auth.ynxweb4.com" || req.Method != "POST" {
			t.Fatal("wrong fixed authority")
		}
		payload := map[string]any{"active": true, "session": body["session"]}
		if req.URL.Path == combinedRevalidationPath {
			payload["browser"] = body["browser"]
		} else if req.URL.Path != revalidationPath {
			t.Fatal("wrong revalidation path")
		}
		if f.mutate != nil {
			f.mutate(payload)
		}
		data := currentCanonical(t, payload)
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}, "Cache-Control": {"no-store"}}, Body: &revalidationCompletionBody{reader: bytes.NewReader(data), closeError: f.closeError, atEOF: func() { clock = f.after }, atClose: func() {
			closed = true
			if f.afterClose != nil {
				clock = *f.afterClose
			}
			if f.cancelOnClose != nil {
				f.cancelOnClose()
			}
		}}, ContentLength: int64(len(data)), Request: req}, nil
	})
	c, e := NewClient("https://wallet-auth.ynxweb4.com", x.policy, transport)
	if e != nil {
		t.Fatal(e)
	}
	c.clock = func() time.Time { clocks++; return time.UnixMilli(clock) }
	r, e := NewBusinessRevalidator(c, c.policy.ClientID+"-sso-v1", "PUBLIC-backend-key", key)
	if e != nil {
		t.Fatal(e)
	}
	f.client = c
	f.r = r
	return f
}
func (f *revalidationFixture) browser(t *testing.T) (*BrowserSSO, string) {
	t.Helper()
	b, e := NewBrowserSSO("social", f.client.endpoint, bytes.Repeat([]byte{0x42}, 32), []string{"home"}, nil)
	if e != nil {
		t.Fatal(e)
	}
	b.now = func() time.Time { return time.UnixMilli(*f.clock) }
	token := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x35}, 32))
	grant := BrowserGrant{GrantToken: token, CSRF: token, Identity: BrowserIdentity{Subject: f.session.Account, Account: f.session.Account, Generation: 1, ExpiresAt: time.UnixMilli(10000)}, Audience: b.audience, Scopes: []string{"identity:read"}, ExpiresAt: time.UnixMilli(10000)}
	sealed, e := b.seal(b.identityCookie, grant)
	if e != nil {
		t.Fatal(e)
	}
	return b, sealed
}

func TestRevalidationCurrentVersionsAndOriginals(t *testing.T) {
	for _, version := range []string{"2", "3"} {
		for _, combined := range []bool{false, true} {
			t.Run(version+map[bool]string{false: "/session", true: "/browser"}[combined], func(t *testing.T) {
				f := revalidationNew(t, version)
				var got Session
				var e error
				if combined {
					b, s := f.browser(t)
					got, _, e = f.r.RevalidateBrowser(context.Background(), f.session, b, s, []string{"social.read"})
				} else {
					got, e = f.r.Revalidate(context.Background(), f.session, []string{"social.read"})
				}
				if e != nil || *f.calls != 1 || !*f.responseClose {
					t.Fatalf("normal revalidation err=%v calls=%d close=%v", e, *f.calls, *f.responseClose)
				}
				if !bytes.Equal(currentCanonical(t, got), currentCanonical(t, f.session)) {
					t.Fatal("original session/account9 lost")
				}
				if *f.clocks != 2 {
					t.Fatalf("want one pre and one post HTTP clock, got %d", *f.clocks)
				}
			})
		}
	}
}
func TestRevalidationCurrentAfterBodyFence(t *testing.T) {
	for _, combined := range []bool{false, true} {
		for _, v := range []struct {
			name  string
			after int64
		}{{"exact-expiry", 10000}, {"rollback", 999}} {
			t.Run(map[bool]string{false: "session/", true: "browser/"}[combined]+v.name, func(t *testing.T) {
				f := revalidationNew(t, "2")
				f.after = v.after
				var e error
				if combined {
					b, s := f.browser(t)
					_, _, e = f.r.RevalidateBrowser(context.Background(), f.session, b, s, []string{"social.read"})
				} else {
					_, e = f.r.Revalidate(context.Background(), f.session, []string{"social.read"})
				}
				if e == nil || *f.calls != 1 || !*f.responseClose {
					t.Fatalf("post-body fence err=%v calls=%d closed=%v", e, *f.calls, *f.responseClose)
				}
			})
		}
	}
}
func TestRevalidationCurrentRejectChangedAccountAuthority(t *testing.T) {
	for _, combined := range []bool{false, true} {
		t.Run(map[bool]string{false: "session", true: "browser"}[combined], func(t *testing.T) {
			f := revalidationNew(t, "3")
			f.mutate = func(p map[string]any) {
				p["session"].(map[string]any)["accountAuthorization"].(map[string]any)["revision"] = "2"
			}
			var e error
			if combined {
				b, s := f.browser(t)
				_, _, e = f.r.RevalidateBrowser(context.Background(), f.session, b, s, []string{"social.read"})
			} else {
				_, e = f.r.Revalidate(context.Background(), f.session, []string{"social.read"})
			}
			if e == nil || *f.calls != 1 {
				t.Fatalf("changed original authority accepted err=%v calls=%d", e, *f.calls)
			}
		})
	}
}
func TestRevalidationCurrentCancellationAndSealedBrowser(t *testing.T) {
	for _, combined := range []bool{false, true} {
		t.Run(map[bool]string{false: "session", true: "browser"}[combined]+"/close-cancel", func(t *testing.T) {
			f := revalidationNew(t, "2")
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			f.cancelOnClose = cancel
			var e error
			if combined {
				b, s := f.browser(t)
				_, _, e = f.r.RevalidateBrowser(ctx, f.session, b, s, []string{"social.read"})
			} else {
				_, e = f.r.Revalidate(ctx, f.session, []string{"social.read"})
			}
			if e == nil || !*f.responseClose {
				t.Fatal("response close cancellation accepted")
			}
		})
	}
	f := revalidationNew(t, "3")
	b, s := f.browser(t)
	if _, _, e := f.r.RevalidateBrowser(context.Background(), f.session, b, s+"x", []string{"social.read"}); e == nil || *f.calls != 0 {
		t.Fatal("unsealed browser contacted authority")
	}
}
func TestRevalidationCurrentInvalidOriginalAccountAuthority(t *testing.T) {
	for _, combined := range []bool{false, true} {
		t.Run(map[bool]string{false: "session", true: "browser"}[combined], func(t *testing.T) {
			f := revalidationNew(t, "3")
			f.session.AccountAuthorization.Revision = "01"
			var e error
			if combined {
				b, s := f.browser(t)
				_, _, e = f.r.RevalidateBrowser(context.Background(), f.session, b, s, []string{"social.read"})
			} else {
				_, e = f.r.Revalidate(context.Background(), f.session, []string{"social.read"})
			}
			if e == nil || *f.calls != 0 {
				t.Fatal("invalid9 contacted authority")
			}
		})
	}
}

func revalidationAction(t *testing.T, version string) (*Client, Session, string, []byte) {
	t.Helper()
	f := revalidationNew(t, version)
	curve := elliptic.P256()
	x, y := curve.ScalarBaseMult([]byte{1})
	key := &ecdsa.PrivateKey{PublicKey: ecdsa.PublicKey{Curve: curve, X: x, Y: y}, D: big.NewInt(1)}
	s := f.session
	s.DeviceKey = base64.RawURLEncoding.EncodeToString(elliptic.MarshalCompressed(curve, x, y))
	body := []byte("{\"PUBLIC\":true}")
	sum := sha256.Sum256(body)
	proof := map[string]any{"version": "2", "sessionBinding": s.SessionBinding, "productId": s.ProductID, "clientId": s.ClientID, "applicationId": s.ApplicationID, "bundleId": nil, "packageId": nil, "origin": s.Origin, "callback": s.Callback, "account": s.Account, "deviceId": s.DeviceID, "deviceKey": s.DeviceKey, "method": "POST", "path": "/api/action", "bodyDigest": hex.EncodeToString(sum[:]), "nonce": strings.Repeat("n", 43), "issuedAt": currentMS(900), "expiresAt": currentMS(2000)}
	unsigned := currentCanonical(t, proof)
	hash := sha256.Sum256(append([]byte("YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n"), unsigned...))
	signature, e := ecdsa.SignASN1(rand.Reader, key, hash[:])
	if e != nil {
		t.Fatal(e)
	}
	proof["signature"] = base64.RawURLEncoding.EncodeToString(signature)
	return f.client, s, base64.RawURLEncoding.EncodeToString(currentCanonical(t, proof)), body
}
func TestRevalidationCurrentBusinessProofV2AndV3(t *testing.T) {
	for _, version := range []string{"2", "3"} {
		t.Run(version, func(t *testing.T) {
			c, s, header, body := revalidationAction(t, version)
			got, e := c.VerifyHTTPAction(header, s, "POST", "/api/action", body, []string{"social.read"}, time.UnixMilli(1500))
			if e != nil || got.Nonce == "" {
				t.Fatalf("original business verifier err=%v", e)
			}
			if _, e = c.VerifyHTTPAction(header, s, "POST", "/api/action", append(body, 'x'), []string{"social.read"}, time.UnixMilli(1500)); e == nil {
				t.Fatal("wrong body accepted")
			}
			if version == "3" {
				s.AccountAuthorization.Revision = "0"
				if _, e = c.VerifyHTTPAction(header, s, "POST", "/api/action", body, []string{"social.read"}, time.UnixMilli(1500)); e == nil {
					t.Fatal("invalid9 admitted business proof")
				}
			}
		})
	}
}

func TestRevalidationCurrentCloseAndOriginalFailure(t *testing.T) {
	for _, combined := range []bool{false, true} {
		for _, mode := range []string{"close-error", "close-expiry", "close-rollback", "first-original-error"} {
			t.Run(map[bool]string{false: "session/", true: "browser/"}[combined]+mode, func(t *testing.T) {
				f := revalidationNew(t, "3")
				switch mode {
				case "close-error":
					f.closeError = io.ErrClosedPipe
				case "close-expiry":
					n := int64(10000)
					f.afterClose = &n
				case "close-rollback":
					n := int64(999)
					f.afterClose = &n
				case "first-original-error":
					f.closeError = io.ErrClosedPipe
					f.mutate = func(p map[string]any) {
						p["session"].(map[string]any)["accountAuthorization"].(map[string]any)["revision"] = "2"
					}
				}
				var e error
				if combined {
					b, s := f.browser(t)
					_, _, e = f.r.RevalidateBrowser(context.Background(), f.session, b, s, []string{"social.read"})
				} else {
					_, e = f.r.Revalidate(context.Background(), f.session, []string{"social.read"})
				}
				if e == nil || *f.calls != 1 || !*f.responseClose {
					t.Fatalf("late HTTP close accepted err=%v", e)
				}
				if mode == "first-original-error" {
					original, ok := e.(*Error)
					if !ok || original.Code != "SESSION_BINDING_MISMATCH" {
						t.Fatalf("first original failure replaced: %v", e)
					}
				}
			})
		}
	}
}
func TestRevalidationCurrentAllScopesAndNilContext(t *testing.T) {
	for _, combined := range []bool{false, true} {
		t.Run(map[bool]string{false: "session", true: "browser"}[combined], func(t *testing.T) {
			f := revalidationNew(t, "3")
			f.session.Scopes = append(f.session.Scopes, "z.unregistered")
			var e error
			if combined {
				b, s := f.browser(t)
				_, _, e = f.r.RevalidateBrowser(context.Background(), f.session, b, s, []string{"social.read"})
			} else {
				_, e = f.r.Revalidate(context.Background(), f.session, []string{"social.read"})
			}
			if e == nil || *f.calls != 0 {
				t.Fatal("all original scopes not enforced")
			}
		})
	}
	f := revalidationNew(t, "3")
	if _, e := f.r.Revalidate(nil, f.session, []string{"social.read"}); e == nil || *f.calls != 0 {
		t.Fatal("nil context entered HTTP")
	}
	var missing *Revalidator
	if _, e := missing.Revalidate(context.Background(), f.session, []string{"social.read"}); e == nil {
		t.Fatal("nil revalidator admitted")
	}
	c, s, header, body := revalidationAction(t, "3")
	s.Scopes = append(s.Scopes, "z.unregistered")
	if _, e := c.VerifyHTTPAction(header, s, "POST", "/api/action", body, []string{"social.read"}, time.UnixMilli(1500)); e == nil {
		t.Fatal("business proof widened unrequired scope")
	}
}

func TestRevalidationCurrentExactResponseAndBrowserBinding(t *testing.T) {
	for _, mode := range []string{"extra", "inactive", "missing-browser", "changed-browser"} {
		t.Run(mode, func(t *testing.T) {
			f := revalidationNew(t, "3")
			f.mutate = func(p map[string]any) {
				switch mode {
				case "extra":
					p["registered"] = true
				case "inactive":
					p["active"] = false
				case "missing-browser":
					delete(p, "browser")
				case "changed-browser":
					p["browser"].(map[string]any)["grant"].(map[string]any)["csrf"] = "PUBLIC-other-token"
				}
			}
			b, s := f.browser(t)
			if _, _, e := f.r.RevalidateBrowser(context.Background(), f.session, b, s, []string{"social.read"}); e == nil || *f.calls != 1 || !*f.responseClose {
				t.Fatalf("combined response not exact: err=%v", e)
			}
		})
	}
}

func TestRevalidationCurrentPrivateNativeFactory(t *testing.T) {
	for _, version := range []string{"2", "3"} {
		t.Run(version, func(t *testing.T) {
			f := revalidationNew(t, version)
			policy := f.client.policy
			policy.Platform = "windows"
			policy.Origin = "app://windows/PUBLIC-social"
			policy.Callback = "publicsocial://callback"
			client, e := NewClient(f.client.endpoint, policy, f.client.http.Transport)
			if e != nil {
				t.Fatal(e)
			}
			client.clock = f.client.clock
			f.session.Platform = policy.Platform
			f.session.Origin = policy.Origin
			f.session.Callback = policy.Callback
			key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x51}, ed25519.SeedSize))
			r, e := NewPrivateBusinessRevalidator(client, policy.ClientID+"-business-windows-v1", "PUBLIC-backend-key", key)
			if e != nil {
				t.Fatal(e)
			}
			got, e := r.Revalidate(context.Background(), f.session, []string{"social.read"})
			if e != nil || *f.calls != 1 || got.Version != version {
				t.Fatalf("normal private native factory failed: %v", e)
			}
		})
	}
}
