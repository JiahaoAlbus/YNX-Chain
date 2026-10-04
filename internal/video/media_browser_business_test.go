//go:build ynx_canonical_media && ynx_media_combined_authority

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
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

func TestVideoCreatorProtectedBrowserAndOriginalBusiness(t *testing.T) {
	source := os.Getenv("YNX_QA_CENTRAL_SOURCE")
	if source == "" || os.Getenv("YNX_QA_MEDIA_MUSIC_EXTENDED") != "1" || os.Getenv("YNX_QA_MEDIA_APPROVED_BROWSER_ROSTER") != "1" {
		t.Skip("requires independently verified matching successor")
	}
	for _, product := range []string{"video", "creator-studio"} {
		t.Run(product, func(t *testing.T) {
			public, key, e := ed25519.GenerateKey(rand.Reader)
			if e != nil {
				t.Fatal(e)
			}
			der, e := x509.MarshalPKIXPublicKey(public)
			if e != nil {
				t.Fatal(e)
			}
			clientID, applicationID, origin := "ynx-video-mobile-v1", "com.ynxweb4.video.web", "https://video.ynxweb4.com"
			scopes := []string{"video:account", "video:library", "video:playback"}
			if product == "creator-studio" {
				clientID = "ynx-creator-studio-web-v1"
				applicationID = "com.ynxweb4.creator-studio.web"
				origin = "https://creator.ynxweb4.com"
				scopes = []string{"creator:account", "creator:publish", "creator:revenue"}
			}
			owned, qaChannel := fixture(t, func(cfg *Config) { cfg.Now = time.Now })
			browserVideoID := ""
			if product == "video" {
				published := upload(t, owned, qaChannel, "Original browser playlist public fixture")
				approveTestPublication(t, owned, qaChannel.Owner, published.ID)
				if e := owned.Publish(qaChannel.Owner, published.ID, VisibilityPublic); e != nil {
					t.Fatal(e)
				}
				browserVideoID = published.ID
			}
			var mu sync.Mutex
			var handler http.Handler
			var browser *productsessionv2.BrowserSSO
			var actor productsessionv2.Session
			bound := false
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
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
					client, e := productsessionv2.NewClient("https://wallet-auth.ynxweb4.com", productsessionv2.Policy{ProductID: product, ClientID: clientID, Platform: "web", ApplicationID: applicationID, Origin: origin, Callback: origin + "/wallet-auth/callback", AllowedScopes: scopes}, transport)
					if e != nil {
						http.Error(w, "QA client denied", 500)
						return
					}
					reader, e := productsessionv2.NewPrivateBusinessRevalidator(client, clientID+"-business-web-v1", "media-qa", key)
					if e != nil {
						http.Error(w, "QA reader denied", 500)
						return
					}
					set, e := productsessionv2.NewRegisteredClientSet(product, []*productsessionv2.Client{client}, []*productsessionv2.Revalidator{reader})
					if e != nil {
						http.Error(w, "QA set denied", 500)
						return
					}
					cookieKey := make([]byte, 32)
					if _, e = rand.Read(cookieKey); e != nil {
						http.Error(w, "QA cookie key denied", 500)
						return
					}
					targets := []string{"settings", "playlists", "discover"}
					if product == "creator-studio" {
						targets = []string{"overview", "channel", "content"}
					}
					browser, e = productsessionv2.NewBrowserSSO(product, "https://wallet-auth.ynxweb4.com", cookieKey, targets, transport)
					if e != nil {
						http.Error(w, "QA browser binding denied", 500)
						return
					}
					authority, e := NewVideoCombinedSDKAuthority(set, set, browser, browser, func(ctx context.Context, _ *http.Request, session productsessionv2.Session, grant productsessionv2.BrowserGrant) (func(context.Context) error, error) {
						if grant.Identity.Account != session.Account {
							return nil, ErrUnauthorized
						}
						mu.Lock()
						defer mu.Unlock()
						if actor.Account == "" {
							actor = session
							actor.Scopes = append([]string(nil), session.Scopes...)
						}
						if !reflect.DeepEqual(actor, session) {
							return nil, ErrUnauthorized
						}
						return func(ctx context.Context) error { return ctx.Err() }, nil
					})
					if e != nil {
						http.Error(w, "QA authority denied", 500)
						return
					}
					owned.cfg.BusinessAuthority = authority
					handler = NewServer(owned, StaticTokenAuth{}).Handler()
					bound = true
					w.WriteHeader(204)
					return
				}
				h := handler
				mu.Unlock()
				if browser != nil {
					switch r.URL.Path {
					case "/sso/start":
						browser.Start(w, r)
						return
					case "/sso/callback":
						browser.Callback(w, r)
						return
					case "/api/sso/account":
						browser.Account(w, r)
						return
					case "/api/sso/logout":
						browser.Logout(w, r)
						return
					}
				}
				if h == nil {
					http.Error(w, "QA not bound", 503)
					return
				}
				h.ServeHTTP(w, r)
			}))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "node", "../../apps/video/scripts/media-browser-authority-check.cjs", source, product)
			cmd.Env = append(os.Environ(), "YNX_QA_BROWSER_VIDEO_ID="+browserVideoID, "YNX_QA_ORIGINAL_MEDIA_URL="+server.URL, "YNX_QA_PUBLIC_KEY="+string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})))
			var output, diagnostic bytes.Buffer
			cmd.Stdout = &output
			cmd.Stderr = &diagnostic
			if e = cmd.Run(); e != nil {
				t.Fatalf("actual protected browser/original business failed: %v %s", e, diagnostic.String())
			}
			var receipt struct {
				ActualOriginalWebPlaylistColdRecovery      bool `json:"actualOriginalWebPlaylistColdRecovery"`
				ActualOriginalWebPickerColdRecovery        bool `json:"actualOriginalWebPickerColdRecovery"`
				OriginalCreateDispatches                   int  `json:"originalCreateDispatches"`
				PickerCreateDispatches                     int  `json:"pickerCreateDispatches"`
				ActualBusinessServerReadback               bool `json:"actualBusinessServerReadback"`
				ActualOldPrivateRetirementBeforeSiteSignIn bool `json:"actualOldPrivateRetirementBeforeSiteSignIn"`
				ActualOriginalBrowserIdentity              bool `json:"actualOriginalBrowserIdentity"`
				ActualCombinedDecision                     bool `json:"actualCombinedDecision"`
				ActualSiteLogout                           bool `json:"actualSiteLogout"`
				ActualGoStartAndCallback303                bool `json:"actualGoStartAndCallback303"`
				RedirectNavigationSoftwareAdapter          bool `json:"redirectNavigationSoftwareAdapter"`
				ActualWalletConsent                        bool `json:"actualWalletConsent"`
				LegacySDK529Preserved                      bool `json:"legacySDK529Preserved"`
			}
			if json.Unmarshal(output.Bytes(), &receipt) != nil || !receipt.ActualBusinessServerReadback || receipt.ActualWalletConsent || !receipt.LegacySDK529Preserved || !receipt.ActualOldPrivateRetirementBeforeSiteSignIn || !receipt.ActualOriginalBrowserIdentity || !receipt.ActualCombinedDecision || !receipt.ActualSiteLogout || !receipt.ActualGoStartAndCallback303 || !receipt.RedirectNavigationSoftwareAdapter {
				t.Fatal("browser receipt gates invalid")
			}
			if product == "video" && (!receipt.ActualOriginalWebPlaylistColdRecovery || !receipt.ActualOriginalWebPickerColdRecovery || receipt.OriginalCreateDispatches != 2 || receipt.PickerCreateDispatches != 2) {
				t.Fatal("original Web playlist cold recovery gates missing")
			}
			mu.Lock()
			defer mu.Unlock()
			if !bound || actor.Account == "" {
				t.Fatal("missing original actor")
			}
			if product == "video" {
				list, e := owned.Playlists(actor.Account)
				if e != nil || len(list) != 1 {
					t.Fatal("missing original Video playlist readback")
				}
			} else {
				found := false
				e = owned.store.read(func(state State) error {
					for _, channel := range state.Channels {
						if channel.Owner == actor.Account && channel.Handle == "protectedcreatorqa" {
							found = true
						}
					}
					return nil
				})
				if e != nil || !found {
					t.Fatal("missing original Creator owned channel readback")
				}
			}
			t.Log("owned frontend/CSP/proxy + original SDK protected Chromium device + original same-account business + replay/cold/revoke; legacy SDK529 bytes preserved; QA identity only")
		})
	}
}
