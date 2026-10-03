//go:build ynx_canonical_media

package music

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
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

const musicSDKSessionHeader = "X-YNX-Product-Session-Proof-V2"
const musicSDKActionHeader = "X-YNX-Music-Business-Proof-V2"

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
func TestMusicFrozenSDKActualCryptoOriginalStoreAndRevocation(t *testing.T) {
	for _, product := range []string{"music"} {
		for _, platform := range []string{"android", "ios"} {
			t.Run(product+"/"+platform, func(t *testing.T) {
				key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
				if e != nil {
					t.Fatal(e)
				}
				application := "com.ynxweb4.music"
				clientID := "ynx-music-v1"
				origin := "https://music.ynxweb4.com"
				scheme := "ynxmusic"
				scope := "music.library"
				s := productsessionv2.Session{Version: "2", SessionBinding: strings.Repeat("a", 64), ChainID: "ynx_6423-1", ProductID: product, ClientID: clientID, Platform: platform, ApplicationID: application + ".web", Origin: origin, Callback: origin + "/wallet-auth/callback", Account: testAccount(t, 6), DeviceID: strings.Repeat("d", 43), DeviceAlgorithm: "p256-sha256", DeviceKey: base64.RawURLEncoding.EncodeToString(elliptic.MarshalCompressed(elliptic.P256(), key.X, key.Y)), DeviceBinding: strings.Repeat("b", 64), Nonce: strings.Repeat("n", 43), State: strings.Repeat("s", 43), Scopes: []string{scope}, RequestDigest: strings.Repeat("c", 64), ApprovalDigest: strings.Repeat("d", 64), IssuedAt: time.Now().Add(-time.Minute).UTC().Format("2006-01-02T15:04:05.000Z"), ExpiresAt: time.Now().Add(time.Minute).UTC().Format("2006-01-02T15:04:05.000Z")}
				if platform != "web" {
					s.ApplicationID = application
					s.Origin = "app://" + platform + "/" + application
					s.Callback = scheme + "://auth/callback"
					if platform == "android" {
						s.PackageID = &application
					} else {
						s.BundleID = &application
					}
				}
				authorizations, reads := 0, 0
				var originalStore *musicStateStore
				revoked, changedActor, changedSession, outage := false, false, false, false
				transport := mediaSDKRoundTrip(func(r *http.Request) (*http.Response, error) {
					var payload any
					status := 200
					switch r.URL.Path {
					case "/v2/product-sessions/introspect":
						authorizations++
						payload = map[string]any{"schemaVersion": 2, "ok": true, "requestId": r.Header.Get("X-Request-Id"), "result": map[string]any{"active": true, "session": s}}
					case "/v2/browser-sessions/product-revalidate":
						if originalStore != nil {
							if !originalStore.mu.TryLock() {
								t.Fatal("remote SDK revalidation held original Store mutex")
							}
							originalStore.mu.Unlock()
						}
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
						if outage {
							status = 503
							payload = map[string]any{"ok": false, "error": map[string]string{"code": "AUTHORITY_UNAVAILABLE"}}
						}
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
				authority, e := NewMusicSDKAuthority(set, func(_ context.Context, _ *http.Request, original productsessionv2.Session) (func(context.Context) error, error) {
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
				body := `{"name":"SDK original library","trackIds":[]}`
				path := "/api/playlists"
				nonce := strings.Repeat("x", 32)
				initial := mediaSDKProof(t, s, key, "POST", "/v2/product-sessions/introspect", string(mediaSDKJSON(t, map[string]any{"requiredScopes": []string{scope}})), strings.Repeat("i", 32), 15*time.Second)
				action := mediaSDKProof(t, s, key, "POST", path, body, nonce, 30*time.Second)
				request := httptest.NewRequest("POST", path, strings.NewReader(body))
				request.Header.Set(musicSDKSessionHeader, initial)
				request.Header.Set(musicSDKActionHeader, action)
				verify := func(wire string) (MusicBusinessGrant, error) {
					return authority.VerifyMusicBusiness(context.Background(), request, scope, strings.NewReader(wire), int64(len(wire)))
				}
				grant, e := verify(body)
				if e != nil {
					t.Fatal("actual signed action rejected", e)
				}
				if e = grant.Revalidate(context.Background()); e != nil {
					t.Fatal(e)
				}
				if authorizations != 1 || reads != 1 {
					t.Fatal("after-await replayed Authorize instead of confidential original read")
				}
				store := testService(t)
				originalStore = store.musicStateStore
				owned := store.requestService(&musicBusinessLease{ctx: context.Background(), grant: grant})
				if _, e = owned.CreatePlaylist(s.Account, "SDK original library", "", nil); e != nil {
					t.Fatal(e)
				}
				restart, e := New(store.cfg)
				if e != nil {
					t.Fatal(e)
				}
				if _, e = restart.requestService(&musicBusinessLease{ctx: context.Background(), grant: grant}).CreatePlaylist(s.Account, "replay", "", nil); e == nil {
					t.Fatal("actual SDK nonce replay accepted after restart")
				}
				store.cfg.BusinessAuthority = authority
				handler := NewServer(store, "", nil).Handler()
				httpAction := mediaSDKProof(t, s, key, "POST", path, body, strings.Repeat("h", 32), 30*time.Second)
				for i, expected := range []int{201, 401} {
					incoming := httptest.NewRequest("POST", path, strings.NewReader(body))
					incoming.Header.Set("Content-Type", "application/json")
					incoming.Header.Set("Idempotency-Key", "original-sdk-http-playlist")
					incoming.Header.Set(musicSDKSessionHeader, mediaSDKProof(t, s, key, "POST", "/v2/product-sessions/introspect", string(mediaSDKJSON(t, map[string]any{"requiredScopes": []string{scope}})), strings.Repeat("j", 31)+string(rune('0'+i)), 15*time.Second))
					incoming.Header.Set(musicSDKActionHeader, httpAction)
					out := httptest.NewRecorder()
					handler.ServeHTTP(out, incoming)
					if out.Code != expected {
						t.Fatalf("original HTTP route: want %d got %d %s", expected, out.Code, out.Body.String())
					}
				}
				if len(store.state.Playlists) != 2 || len(store.state.BusinessNonces) != 2 {
					t.Fatal("HTTP replay changed original library or nonce journal")
				}
				if _, e = verify(body + " "); e == nil {
					t.Fatal("tampered exact wire accepted")
				}
				request.Header.Set(musicSDKActionHeader, mediaSDKProof(t, s, key, "DELETE", path, body, strings.Repeat("y", 32), 30*time.Second))
				if _, e = verify(body); e == nil {
					t.Fatal("method escalation accepted")
				}
				request.Header.Set(musicSDKActionHeader, action)
				outage = true
				if e = grant.Revalidate(context.Background()); !errors.Is(e, ErrMusicAuthorityUnavailable) {
					t.Fatalf("SDK outage collapsed into revocation: %v", e)
				}
				beforePlaylists, beforeNonces := len(store.state.Playlists), len(store.state.BusinessNonces)
				if _, e = owned.CreatePlaylist(s.Account, "outage forbidden", "", nil); !errors.Is(e, ErrMusicAuthorityUnavailable) {
					t.Fatalf("outage write: %v", e)
				}
				if len(store.state.Playlists) != beforePlaylists || len(store.state.BusinessNonces) != beforeNonces {
					t.Fatal("outage changed original business state")
				}
				outHold := httptest.NewRecorder()
				holdResponse := &scopedResponse{ResponseWriter: outHold, lease: &musicBusinessLease{ctx: context.Background(), grant: grant}, now: store.cfg.Now}
				if _, e = holdResponse.Write([]byte("private")); !errors.Is(e, ErrMusicAuthorityUnavailable) || outHold.Code != 503 || outHold.Body.Len() != 0 {
					t.Fatalf("outage response: %d %v", outHold.Code, e)
				}
				flushHold := httptest.NewRecorder()
				flushResponse := &scopedResponse{ResponseWriter: flushHold, lease: &musicBusinessLease{ctx: context.Background(), grant: grant}, now: store.cfg.Now}
				flushResponse.Flush()
				if _, e = flushResponse.Write([]byte("late private")); !errors.Is(e, ErrMusicAuthorityUnavailable) || flushHold.Code != 503 || flushHold.Body.Len() != 0 {
					t.Fatalf("outage flush leaked or lost error: %d %v", flushHold.Code, e)
				}
				outage = false
				if e = grant.Revalidate(context.Background()); e != nil {
					t.Fatalf("original session cannot retry after outage: %v", e)
				}
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
func TestMusicSDKMissingTrustedConfiguration(t *testing.T) {
	if _, e := NewMusicSDKAuthority(nil, nil); e == nil {
		t.Fatal("missing authority accepted")
	}
}
