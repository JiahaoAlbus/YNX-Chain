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
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

func TestVideoCreatorNativeConsumerAndOriginalBusiness(t *testing.T) {
	source := os.Getenv("YNX_QA_CENTRAL_SOURCE")
	if source == "" || os.Getenv("YNX_QA_MEDIA_MUSIC_EXTENDED") != "1" {
		t.Skip("requires independently verified matching successor")
	}
	for _, target := range []string{"video:android", "video:macos", "creator-studio:android", "creator-studio:macos"} {
		t.Run(target, func(t *testing.T) {
			parts := strings.Split(target, ":")
			product, platform := parts[0], parts[1]
			public, key, e := ed25519.GenerateKey(rand.Reader)
			if e != nil {
				t.Fatal(e)
			}
			der, e := x509.MarshalPKIXPublicKey(public)
			if e != nil {
				t.Fatal(e)
			}
			clientID, applicationID, origin := "ynx-video-mobile-v1", "com.ynxweb4.video", ""
			scopes := []string{"video:account", "video:library", "video:playback"}
			if product == "creator-studio" {
				clientID = "ynx-creator-studio-web-v1"
				applicationID = "com.ynxweb4.creator-studio"
				origin = ""
				scopes = []string{"creator:account", "creator:publish", "creator:revenue"}
			}
			origin = "app://" + platform + "/" + applicationID
			callback := "ynxvideo://wallet-auth/callback"
			if product == "creator-studio" {
				callback = "ynxcreator://wallet-auth/callback"
			}
			owned, _ := fixture(t, func(cfg *Config) { cfg.Now = time.Now })
			var mu sync.Mutex
			var handler http.Handler
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
					var bundleID, packageID *string
					if platform == "android" {
						packageID = &applicationID
					} else {
						bundleID = &applicationID
					}
					client, e := productsessionv2.NewClient("https://wallet-auth.ynxweb4.com", productsessionv2.Policy{ProductID: product, ClientID: clientID, Platform: platform, ApplicationID: applicationID, Origin: origin, Callback: callback, BundleID: bundleID, PackageID: packageID, AllowedScopes: scopes}, transport)
					if e != nil {
						http.Error(w, "QA client denied", 500)
						return
					}
					reader, e := productsessionv2.NewPrivateBusinessRevalidator(client, clientID+"-business-"+platform+"-v1", "media-qa", key)
					if e != nil {
						http.Error(w, "QA reader denied", 500)
						return
					}
					set, e := productsessionv2.NewRegisteredClientSet(product, []*productsessionv2.Client{client}, []*productsessionv2.Revalidator{reader})
					if e != nil {
						http.Error(w, "QA set denied", 500)
						return
					}
					authority, e := NewVideoSDKAuthority(set, set, func(ctx context.Context, _ *http.Request, session productsessionv2.Session) (func(context.Context) error, error) {
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
				if h == nil {
					http.Error(w, "QA not bound", 503)
					return
				}
				h.ServeHTTP(w, r)
			}))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "node", "../../apps/video/scripts/media-native-authority-check.mjs", source, product, platform)
			cmd.Env = append(os.Environ(), "YNX_QA_ORIGINAL_MEDIA_URL="+server.URL, "YNX_QA_PUBLIC_KEY="+string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})))
			var output, diagnostic bytes.Buffer
			cmd.Stdout = &output
			cmd.Stderr = &diagnostic
			if e = cmd.Run(); e != nil {
				t.Fatalf("actual native consumer/original business failed: %v %s", e, diagnostic.String())
			}
			var receipt struct {
				ActualBusinessServerReadback bool `json:"actualBusinessServerReadback"`
				ActualWalletConsent          bool `json:"actualWalletConsent"`
				QAProtectedPorts             bool `json:"qaProtectedPorts"`
			}
			if json.Unmarshal(output.Bytes(), &receipt) != nil || !receipt.ActualBusinessServerReadback || receipt.ActualWalletConsent || !receipt.QAProtectedPorts {
				t.Fatal("native consumer receipt gates invalid")
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
			t.Log("actual NativeSDK + owned native consumer + original business + context/cold/revoke; software QA ports, no installed OS or real Wallet claim")
		})
	}
}
