//go:build ynx_canonical_media

package video

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
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type mediaSDKRoundTrip func(*http.Request) (*http.Response, error)

func (f mediaSDKRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func mediaSDKJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, e := json.Marshal(v)
	if e != nil {
		t.Fatal(e)
	}
	var generic any
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	if e = d.Decode(&generic); e != nil {
		t.Fatal(e)
	}
	var output bytes.Buffer
	encoder := json.NewEncoder(&output)
	encoder.SetEscapeHTML(false)
	if e = encoder.Encode(generic); e != nil {
		t.Fatal(e)
	}
	return bytes.TrimSuffix(output.Bytes(), []byte("\n"))
}

// These tests use ephemeral QA signing keys and an isolated authority response.
// Actual SDK action signatures are verified; this is not actual Wallet consent.
func mediaSDKProof(t *testing.T, s productsessionv2.Session, key *ecdsa.PrivateKey, method, path, body, nonce string, life time.Duration) string {
	t.Helper()
	sum := sha256.Sum256([]byte(body))
	now := time.Now().UTC().Truncate(time.Millisecond).Add(-time.Second)
	p := map[string]any{"version": "2", "sessionBinding": s.SessionBinding, "productId": s.ProductID, "clientId": s.ClientID, "applicationId": s.ApplicationID, "bundleId": s.BundleID, "packageId": s.PackageID, "origin": s.Origin, "callback": s.Callback, "account": s.Account, "deviceId": s.DeviceID, "deviceKey": s.DeviceKey, "method": method, "path": path, "bodyDigest": hex.EncodeToString(sum[:]), "nonce": nonce, "issuedAt": now.Format("2006-01-02T15:04:05.000Z"), "expiresAt": now.Add(life).Format("2006-01-02T15:04:05.000Z")}
	signed := sha256.Sum256(append([]byte("YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n"), mediaSDKJSON(t, p)...))
	sig, e := ecdsa.SignASN1(rand.Reader, key, signed[:])
	if e != nil {
		t.Fatal(e)
	}
	p["signature"] = base64.RawURLEncoding.EncodeToString(sig)
	return base64.RawURLEncoding.EncodeToString(mediaSDKJSON(t, p))
}
func TestMediaFrozenSDKActualCryptoOriginalStoreAndRevocation(t *testing.T) {
	for _, product := range []string{"video", "creator-studio"} {
		for _, platform := range []string{"web", "android", "macos"} {
			t.Run(product+"/"+platform, func(t *testing.T) {
				key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
				if e != nil {
					t.Fatal(e)
				}
				application := "com.ynxweb4.video"
				clientID := "ynx-video-mobile-v1"
				origin := "https://video.ynxweb4.com"
				scheme := "ynxvideo"
				scope := "video:library"
				if product == "creator-studio" {
					application = "com.ynxweb4.creator-studio"
					clientID = "ynx-creator-studio-web-v1"
					origin = "https://creator.ynxweb4.com"
					scheme = "ynxcreator"
					scope = "creator:publish"
				}
				s := productsessionv2.Session{Version: "2", SessionBinding: strings.Repeat("a", 64), ChainID: "ynx_6423-1", ProductID: product, ClientID: clientID, Platform: platform, ApplicationID: application + ".web", Origin: origin, Callback: origin + "/wallet-auth/callback", Account: testOwnerAccount, DeviceID: strings.Repeat("d", 43), DeviceAlgorithm: "p256-sha256", DeviceKey: base64.RawURLEncoding.EncodeToString(elliptic.MarshalCompressed(elliptic.P256(), key.X, key.Y)), DeviceBinding: strings.Repeat("b", 64), Nonce: strings.Repeat("n", 43), State: strings.Repeat("s", 43), Scopes: []string{scope}, RequestDigest: strings.Repeat("c", 64), ApprovalDigest: strings.Repeat("d", 64), IssuedAt: time.Now().Add(-time.Minute).UTC().Format("2006-01-02T15:04:05.000Z"), ExpiresAt: time.Now().Add(time.Minute).UTC().Format("2006-01-02T15:04:05.000Z")}
				if platform != "web" {
					s.ApplicationID = application
					s.Origin = "app://" + platform + "/" + application
					s.Callback = scheme + "://wallet-auth/callback"
					if platform == "android" {
						s.PackageID = &application
					} else {
						s.BundleID = &application
					}
				}
				authorizations, reads := 0, 0
				revoked, changedActor, changedSession := false, false, false
				transport := mediaSDKRoundTrip(func(r *http.Request) (*http.Response, error) {
					var payload any
					status := 200
					switch r.URL.Path {
					case "/v2/product-sessions/introspect":
						authorizations++
						payload = map[string]any{"schemaVersion": 2, "ok": true, "requestId": r.Header.Get("X-Request-Id"), "result": map[string]any{"active": true, "session": s}}
					case "/v2/browser-sessions/product-revalidate":
						reads++
						var request struct {
							Session productsessionv2.Session `json:"session"`
						}
						if json.NewDecoder(r.Body).Decode(&request) != nil || !reflect.DeepEqual(request.Session, s) {
							t.Fatal("full original SDK session lost or mutated")
						}
						returned := s
						if changedSession {
							returned.State = "different-original-state"
						}
						payload = map[string]any{"active": true, "session": returned}
						if revoked {
							status = 401
							payload = map[string]any{"ok": false, "error": map[string]string{"code": "SESSION_REVOKED"}}
						}
					default:
						t.Fatalf("unexpected SDK upstream %s", r.URL.Path)
					}
					b := mediaSDKJSON(t, payload)
					return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}, "Cache-Control": []string{"no-store"}, "X-Request-Id": []string{r.Header.Get("X-Request-Id")}}, Body: io.NopCloser(strings.NewReader(string(b))), ContentLength: int64(len(b)), Request: r}, nil
				})
				client, e := productsessionv2.NewClient("https://wallet-auth.ynxweb4.com", productsessionv2.Policy{ProductID: product, ClientID: clientID, Platform: platform, ApplicationID: s.ApplicationID, Origin: s.Origin, Callback: s.Callback, BundleID: s.BundleID, PackageID: s.PackageID, AllowedScopes: s.Scopes}, transport)
				if e != nil {
					t.Fatal(e)
				}
				reader, e := productsessionv2.NewPrivateBusinessRevalidator(client, clientID+"-business-"+platform+"-v1", "isolated-media-qa", ed25519.NewKeyFromSeed(make([]byte, 32)))
				if e != nil {
					t.Fatal(e)
				}
				set, e := productsessionv2.NewRegisteredClientSet(product, []*productsessionv2.Client{client}, []*productsessionv2.Revalidator{reader})
				if e != nil {
					t.Fatal(e)
				}
				authority, e := NewVideoSDKAuthority(set, set, func(_ context.Context, _ *http.Request, original productsessionv2.Session) (func(context.Context) error, error) {
					if !reflect.DeepEqual(original, s) {
						t.Fatal("actor hook lost original tuple")
					}
					original.Scopes[0] = "mutated-hook-copy"
					return func(context.Context) error {
						if changedActor {
							return ErrUnauthorized
						}
						return nil
					}, nil
				})
				if e != nil {
					t.Fatal(e)
				}
				body := `{"Name":"SDK original library"}`
				path := "/v1/playlists"
				nonce := strings.Repeat("x", 32)
				initial := mediaSDKProof(t, s, key, "POST", "/v2/product-sessions/introspect", string(mediaSDKJSON(t, map[string]any{"requiredScopes": []string{scope}})), strings.Repeat("i", 32), 15*time.Second)
				action := mediaSDKProof(t, s, key, "POST", path, body, nonce, 30*time.Second)
				request := httptest.NewRequest("POST", path, strings.NewReader(body))
				request.Header.Set(productSessionProofV2Header, initial)
				request.Header.Set(videoActionProofHeader, action)
				verify := func(wire string) (VideoBusinessGrant, error) {
					return authority.VerifyVideoBusiness(context.Background(), request, scope, strings.NewReader(wire), int64(len(wire)))
				}
				grant, e := verify(body)
				if e != nil {
					t.Fatal("actual signed action rejected", e)
				}
				if !grant.SessionExpiresAt.Equal(mustSDKTime(t, s.ExpiresAt)) || grant.ExpiresAt.After(grant.SessionExpiresAt) {
					t.Fatal("proof expiry substituted for full session")
				}
				if e = grant.Revalidate(context.Background()); e != nil {
					t.Fatal(e)
				}
				if authorizations != 1 || reads != 1 {
					t.Fatal("after-await replayed Authorize instead of confidential original read")
				}
				store, _ := fixture(t, func(c *Config) { c.Now = time.Now })
				owned := videoLease(t, store, context.Background(), grant, false)
				if _, e = owned.CreatePlaylist(grant.Actor, "SDK original library"); e != nil {
					t.Fatal(e)
				}
				restart, e := NewService(store.cfg)
				if e != nil {
					t.Fatal(e)
				}
				if _, e = videoLease(t, restart, context.Background(), grant, false).CreatePlaylist(grant.Actor, "replay"); e == nil {
					t.Fatal("actual SDK nonce replay accepted after restart")
				}
				// Exercise the shipped HTTP spool, SDK and original business route
				// together, then retry the consumed action with a fresh introspection.
				store.cfg.BusinessAuthority = authority
				handler := NewServer(store, StaticTokenAuth{}).Handler()
				httpAction := mediaSDKProof(t, s, key, "POST", path, body, strings.Repeat("h", 32), 30*time.Second)
				// The original idempotent mutation wrapper reports replay rejection
				// as 409; it must contain unauthorized and cannot return a receipt.
				for i, expected := range []int{200, 409} {
					incoming := httptest.NewRequest("POST", path, strings.NewReader(body))
					incoming.Header.Set("Content-Type", "application/json")
					incoming.Header.Set("Idempotency-Key", "original-sdk-http-playlist")
					incoming.Header.Set(productSessionProofV2Header, mediaSDKProof(t, s, key, "POST", "/v2/product-sessions/introspect", string(mediaSDKJSON(t, map[string]any{"requiredScopes": []string{scope}})), strings.Repeat("j", 31)+string(rune('0'+i)), 15*time.Second))
					incoming.Header.Set(videoActionProofHeader, httpAction)
					out := httptest.NewRecorder()
					handler.ServeHTTP(out, incoming)
					if out.Code != expected {
						t.Fatalf("original HTTP route: want %d got %d %s", expected, out.Code, out.Body.String())
					}
					if i == 1 && !strings.Contains(out.Body.String(), "unauthorized") {
						t.Fatal("replay returned a success receipt")
					}
				}
				lists, e := store.Playlists(s.Account)
				if e != nil || len(lists) != 2 || len(store.store.state.BusinessNonces) != 2 {
					t.Fatal("HTTP replay changed original library or nonce journal", e)
				}
				if _, e = verify(body + " "); e == nil {
					t.Fatal("tampered exact wire accepted")
				}
				request.Header.Set(videoActionProofHeader, mediaSDKProof(t, s, key, "DELETE", path, body, strings.Repeat("y", 32), 30*time.Second))
				if _, e = verify(body); e == nil {
					t.Fatal("method escalation accepted")
				}
				request.Header.Set(videoActionProofHeader, action)
				changedActor = true
				before := reads
				if e = grant.Revalidate(context.Background()); e == nil || reads != before {
					t.Fatal("changed current actor reached authority or remained authorized")
				}
				changedActor = false
				changedSession = true
				if e = grant.Revalidate(context.Background()); e == nil {
					t.Fatal("different full original session accepted")
				}
				changedSession = false
				revoked = true
				if e = grant.Revalidate(context.Background()); e == nil {
					t.Fatal("revoked session accepted")
				}
			})
		}
	}
}
func mustSDKTime(t *testing.T, s string) time.Time {
	t.Helper()
	v, e := time.Parse(time.RFC3339Nano, s)
	if e != nil {
		t.Fatal(e)
	}
	return v
}
func TestMediaSDKMissingTrustedConfiguration(t *testing.T) {
	if _, e := NewVideoSDKAuthority(nil, nil, nil); e == nil {
		t.Fatal("missing authority accepted")
	}
}
