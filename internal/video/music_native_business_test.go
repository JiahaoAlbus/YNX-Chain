//go:build ynx_canonical_media

package video

import (
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
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	musicapp "github.com/JiahaoAlbus/YNX-Chain/apps/music"
	"github.com/JiahaoAlbus/YNX-Chain/internal/music"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Original Music HTTP + owned browser lifecycle + genuine protected browser
// device + actual Node authority. Host actor binding is disposable QA only.
func TestMusicNativeConsumerAndOriginalBusiness(t *testing.T) {
	source := os.Getenv("YNX_QA_CENTRAL_SOURCE")
	if source == "" || os.Getenv("YNX_QA_MEDIA_MUSIC_EXTENDED") != "1" {
		t.Skip("requires independently verified Music successor package")
	}
	platforms := []string{"android", "macos"}
	if os.Getenv("YNX_QA_APPLE_MUSIC_ENGINE_BIN") != "" {
		platforms = append(platforms, "ios")
	}
	for _, platform := range platforms {
		t.Run(platform, func(t *testing.T) {
			public, key, err := ed25519.GenerateKey(rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			der, err := x509.MarshalPKIXPublicKey(public)
			if err != nil {
				t.Fatal(err)
			}
			scopes := []string{"music.creator", "music.library", "music.playback", "music.profile"}
			var mu sync.Mutex
			var handler http.Handler
			var owned *music.Service
			var actor productsessionv2.Session
			var bound bool
			var originalConfig music.Config
			var trustConfigured bool
			var trustReceipts atomic.Int32
			// Explicit isolated HTTPS receipt provider, not Central Trust.
			// Original SDK authority, actor and production HTTPS/effect gates remain.
			trustProvider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var input struct {
					Type     string `json:"type"`
					Key      string `json:"idempotencyKey"`
					Subject  string `json:"subject"`
					Scope    string `json:"requestScope"`
					Purpose  string `json:"purpose"`
					Action   string `json:"requestedAction"`
					Evidence []struct {
						Source      string    `json:"source"`
						Digest      string    `json:"digest"`
						Summary     string    `json:"summary"`
						CollectedAt time.Time `json:"collectedAt"`
						Visible     bool      `json:"visibleToSubject"`
					} `json:"evidence"`
				}
				decode := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
				decode.DisallowUnknownFields()
				if r.Method != "POST" || r.URL.Path != "/original-case" || r.Header.Get("Authorization") != "Bearer isolated-music-trust-receipt" || r.Header.Get("X-YNX-Product-Client") != "ynx-music-v1" || decode.Decode(&input) != nil || input.Type != "open_case" || !strings.HasPrefix(input.Key, "music-trust-") || !strings.HasPrefix(input.Subject, "trk_") || input.Scope != "music.rights" || input.Action != "report" || len(input.Evidence) != 1 || input.Evidence[0].Source != "ynx-music" || input.Evidence[0].Summary != input.Purpose || input.Evidence[0].CollectedAt.IsZero() || !input.Evidence[0].Visible {
					t.Error("isolated original Trust request contract mismatch")
					http.Error(w, "invalid isolated provider request", 400)
					return
				}
				expectedReason, expectedDigest := "Original unavailable Apple Trust retry", "sha256:original-apple-case-evidence"
				if platform == "android" {
					expectedReason, expectedDigest = "Original unavailable Trust retry", "sha256:original-native-case-evidence"
				}
				if input.Purpose != expectedReason || input.Evidence[0].Digest != expectedDigest {
					t.Error("original Trust request contents changed")
					http.Error(w, "changed isolated evidence", 400)
					return
				}
				if trustReceipts.Add(1) != 1 {
					t.Error("original same-key Trust request dispatched twice")
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"isolated-original-trust-receipt-1"}`))
			}))
			defer trustProvider.Close()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				if r.URL.Path == "/qa-enable-trust" {
					defer mu.Unlock()
					if r.Method != "POST" || !bound || trustConfigured || owned == nil || actor.Account == "" {
						http.Error(w, "isolated Trust configuration denied", 409)
						return
					}
					// Reopen the ORIGINAL persisted Music store with an isolated
					// provider config; never change an actor/SDK grant or key.
					cfg := originalConfig
					cfg.TrustGatewayURL = trustProvider.URL + "/original-case"
					cfg.TrustGatewayKey = "isolated-music-trust-receipt"
					cfg.HTTPClient = trustProvider.Client()
					reopened, e := music.New(cfg)
					if e != nil {
						http.Error(w, "original store reopen failed", 500)
						return
					}
					owned = reopened
					handler = music.NewServer(owned, "", musicapp.Web()).Handler()
					trustConfigured = true
					w.WriteHeader(204)
					return
				}
				if r.URL.Path == "/qa-bind" {
					defer mu.Unlock()
					if bound || r.Method != "POST" {
						http.Error(w, "QA bind denied", 400)
						return
					}
					var input struct {
						URL string `json:"url"`
					}
					if json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&input) != nil {
						http.Error(w, "QA input denied", 400)
						return
					}
					endpoint, e := url.Parse(input.URL)
					if e != nil || endpoint.Scheme != "http" || endpoint.Hostname() != "127.0.0.1" || endpoint.Path != "" {
						http.Error(w, "QA endpoint denied", 400)
						return
					}
					transport := mediaSDKRoundTrip(func(request *http.Request) (*http.Response, error) {
						if request.URL.Host != "wallet-auth.ynxweb4.com" {
							return nil, ErrUnauthorized
						}
						copy := request.Clone(request.Context())
						target := *request.URL
						target.Scheme = endpoint.Scheme
						target.Host = endpoint.Host
						copy.URL = &target
						return http.DefaultTransport.RoundTrip(copy)
					})
					applicationID := "com.ynxweb4.music"
					var bundleID, packageID *string
					if platform == "android" {
						packageID = &applicationID
					} else {
						bundleID = &applicationID
					}
					client, e := productsessionv2.NewClient("https://wallet-auth.ynxweb4.com", productsessionv2.Policy{ProductID: "music", ClientID: "ynx-music-v1", Platform: platform, ApplicationID: applicationID, Origin: "app://" + platform + "/" + applicationID, Callback: "ynxmusic://auth/callback", BundleID: bundleID, PackageID: packageID, AllowedScopes: scopes}, transport)
					if e != nil {
						http.Error(w, "QA client denied", 500)
						return
					}
					reader, e := productsessionv2.NewPrivateBusinessRevalidator(client, "ynx-music-v1-business-"+platform+"-v1", "media-qa", key)
					if e != nil {
						http.Error(w, "QA reader denied", 500)
						return
					}
					set, e := productsessionv2.NewRegisteredClientSet("music", []*productsessionv2.Client{client}, []*productsessionv2.Revalidator{reader})
					if e != nil {
						http.Error(w, "QA set denied", 500)
						return
					}
					authority, e := music.NewMusicSDKAuthority(set, func(ctx context.Context, _ *http.Request, session productsessionv2.Session) (func(context.Context) error, error) {
						mu.Lock()
						defer mu.Unlock()
						if actor.Account == "" {
							actor = session
							actor.Scopes = append([]string(nil), session.Scopes...)
						}
						if !reflect.DeepEqual(actor, session) {
							return nil, music.ErrUnauthorized
						}
						// Immutable actor for this fresh isolated QA run; no Central identity claim.
						return func(ctx context.Context) error { return ctx.Err() }, nil
					})
					if e != nil {
						http.Error(w, "QA authority denied", 500)
						return
					}
					originalConfig = music.Config{StatePath: filepath.Join(t.TempDir(), "state.json"), MediaDir: t.TempDir(), MaxUploadBytes: 1 << 20, Now: time.Now, BusinessAuthority: authority}
					owned, e = music.New(originalConfig)
					if e != nil {
						http.Error(w, "QA original store denied", 500)
						return
					}
					handler = music.NewServer(owned, "", musicapp.Web()).Handler()
					bound = true
					w.WriteHeader(204)
					return
				}
				h := handler
				mu.Unlock()
				if h == nil {
					http.Error(w, "QA not bound", 503)
					return
				}
				h.ServeHTTP(w, r)
			}))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			script := "../../apps/video/scripts/media-native-authority-check.mjs"
			apple := platform != "android" && os.Getenv("YNX_QA_APPLE_MUSIC_ENGINE_BIN") != ""
			if apple {
				script = "../../apps/music/scripts/apple-native-authority-check.mjs"
			}
			cmd := exec.CommandContext(ctx, "node", script, source, "music", platform)
			cmd.Env = append(os.Environ(), "YNX_QA_ORIGINAL_MEDIA_URL="+server.URL, "YNX_QA_PUBLIC_KEY="+string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})))
			var output, diagnostic bytes.Buffer
			cmd.Stdout = &output
			cmd.Stderr = &diagnostic
			if err = cmd.Run(); err != nil {
				t.Fatalf("actual Native consumer/original business failed: %v %s", err, diagnostic.String())
			}
			var receipt struct {
				ActualBusinessServerReadback            bool `json:"actualBusinessServerReadback"`
				ActualAppleSwiftWebKitEngine            bool `json:"actualAppleSwiftWebKitEngine"`
				ActualOriginalAppleModelFlow            bool `json:"actualOriginalAppleModelFlow"`
				ActualJavaMusicUpload                   bool `json:"actualJavaMusicUpload"`
				ActualWalletConsent                     bool `json:"actualWalletConsent"`
				OriginalTrustConfirmedLostReplyRecovery bool `json:"originalTrustConfirmedLostReplyRecovery"`
				IsolatedTrustReceipt                    bool `json:"isolatedTrustReceipt"`
				JavaUpload                              struct {
					OriginalTrustConfirmedLostReplyRecovery bool `json:"originalTrustConfirmedLostReplyRecovery"`
					IsolatedTrustReceipt                    bool `json:"isolatedTrustReceipt"`
				} `json:"javaUpload"`
			}
			if json.Unmarshal(output.Bytes(), &receipt) != nil || !receipt.ActualBusinessServerReadback || receipt.ActualWalletConsent || apple && (!receipt.ActualAppleSwiftWebKitEngine || !receipt.ActualOriginalAppleModelFlow) {
				t.Fatal("browser receipt gate invalid")
			}
			javaUpload := platform == "android" && os.Getenv("YNX_QA_ANDROID_MUSIC_UPLOAD_CLASSES") != ""
			if javaUpload && !receipt.ActualJavaMusicUpload {
				t.Fatal("original Java upload receipt missing")
			}
			mu.Lock()
			defer mu.Unlock()
			if !bound || actor.Account == "" || owned == nil || len(owned.Playlists(actor.Account)) != 1 {
				t.Fatal("missing original same-account playlist readback")
			}
			if javaUpload && len(owned.CreatorTracks(actor.Account)) != 1 {
				t.Fatal("original Java upload duplicated or missing")
			}
			if apple && len(owned.CreatorTracks(actor.Account)) != 2 {
				t.Fatal("missing deduplicated original upload readback")
			}
			if javaUpload || apple {
				if !trustConfigured || trustReceipts.Load() != 1 || javaUpload && (!receipt.JavaUpload.OriginalTrustConfirmedLostReplyRecovery || !receipt.JavaUpload.IsolatedTrustReceipt) || apple && (!receipt.OriginalTrustConfirmedLostReplyRecovery || !receipt.IsolatedTrustReceipt) {
					t.Fatal("original Trust receipt/lost-reply recovery gate invalid")
				}
				snap, e := owned.Snapshot(actor.Account)
				if e != nil {
					t.Fatal(e)
				}
				cases, ok := snap["cases"].([]music.Case)
				if !ok || len(cases) != 1 || cases[0].CentralCaseID != "isolated-original-trust-receipt-1" {
					t.Fatal("original Trust case duplicated or receipt missing")
				}
				t.Log("original Trust success/lost-native-reply/cold-original-key replay: one original case, one isolated HTTPS provider dispatch; actual Central Trust/Wallet/install NOT_VERIFIED")
			}
			t.Log("actual Native SDK -> own native Music consumer -> original HTTP account/playlist, cold/revoke; software QA ports, real OS/Wallet unverified")
		})
	}
}
