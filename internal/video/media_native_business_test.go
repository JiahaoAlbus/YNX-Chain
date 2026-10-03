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
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Explicit isolated provider for the native controller's NDJSON/cancel QA.
// It is never wired into product source or represented as a real Gateway.
type nativeCreatorQAStreamer struct{ starts *atomic.Int64 }

func (nativeCreatorQAStreamer) Generate(context.Context, AIRequest) (AIResult, error) {
	return AIResult{}, ErrForbidden
}
func (provider nativeCreatorQAStreamer) Stream(ctx context.Context, request AIRequest, emit func(string) error) (AIResult, error) {
	provider.starts.Add(1)
	if err := emit("Isolated QA first"); err != nil {
		return AIResult{}, err
	}
	select {
	case <-ctx.Done():
		return AIResult{}, ctx.Err()
	case <-time.After(800 * time.Millisecond):
	}
	if err := emit(" second"); err != nil {
		return AIResult{}, err
	}
	return AIResult{Provider: "isolated-original-service-QA", Model: "explicit-test-streamer", Text: "Isolated QA first second", Units: 7}, nil
}

func TestVideoCreatorNativeConsumerAndOriginalBusiness(t *testing.T) {
	source := os.Getenv("YNX_QA_CENTRAL_SOURCE")
	if source == "" || os.Getenv("YNX_QA_MEDIA_MUSIC_EXTENDED") != "1" {
		t.Skip("requires independently verified matching successor")
	}
	targets := []string{"video:android", "video:macos", "creator-studio:android", "creator-studio:macos"}
	if os.Getenv("YNX_QA_APPLE_VIDEO_ENGINE_BIN") != "" {
		targets = append(targets, "video:ios")
	}
	if os.Getenv("YNX_QA_APPLE_CREATOR_ENGINE_BIN") != "" {
		targets = append(targets, "creator-studio:ios")
	}
	for _, target := range targets {
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
			var aiStarts atomic.Int64
			owned, originalChannel := fixture(t, func(cfg *Config) {
				cfg.Now = time.Now
				// The legacy 96-byte fixture only fits one tiny video. This
				// isolated original-service journey also saves real PNG/VTT
				// bytes; production quota and separate quota regressions stay
				// unchanged.
				if product == "creator-studio" && (platform == "ios" || platform == "macos") && os.Getenv("YNX_QA_APPLE_CREATOR_ENGINE_BIN") != "" {
					cfg.AccountQuotaBytes = 16 << 20
					cfg.AI = nativeCreatorQAStreamer{starts: &aiStarts}
				}
			})
			nativeMediaKey, nativeVideoID := "", ""
			if product == "video" {
				published := upload(t, owned, originalChannel, "Original Native media fixture")
				approveTestPublication(t, owned, originalChannel.Owner, published.ID)
				if e := owned.Publish(originalChannel.Owner, published.ID, VisibilityPublic); e != nil {
					t.Fatal(e)
				}
				nativeMediaKey, nativeVideoID = published.ObjectKey, published.ID
			}
			var mu sync.Mutex
			var handler http.Handler
			var actor productsessionv2.Session
			// Only two known disposable sample Wallet accounts are admitted by
			// this QA host. Each exact original SDK session remains independently
			// bound; this is not a deployed Host/currentActor receipt.
			creatorReview := product == "creator-studio" && (platform == "ios" || platform == "macos") && os.Getenv("YNX_QA_APPLE_CREATOR_ENGINE_BIN") != ""
			actors := map[string]productsessionv2.Session{}
			// Original SDK5c walletIdentity for disposable secp256k1 samples 1 and 5;
			// these are not the address-only unit fixtures in service_test.go.
			creatorOwner := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
			creatorModerator := "ynx1ux4cz30hu4wujv74rgvv0yleqx36pvnk4v9qf4"
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
						if creatorReview {
							if session.Account != creatorOwner && session.Account != creatorModerator {
								return nil, ErrUnauthorized
							}
							previous, found := actors[session.Account]
							if found && !reflect.DeepEqual(previous, session) {
								return nil, ErrUnauthorized
							}
							actors[session.Account] = session
							return func(ctx context.Context) error { return ctx.Err() }, nil
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
					moderators := map[string]bool{}
					if creatorReview {
						moderators[creatorModerator] = true
					}
					// Original server-owned moderator admission is separate from
					// channel team acceptance and original SDK account authority.
					handler = NewServer(owned, StaticTokenAuth{Moderators: moderators}).Handler()
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
			qaTimeout := 60 * time.Second
			if creatorReview {
				qaTimeout = 120 * time.Second
			} // full original Creator journey includes explicit AI and finance steps
			ctx, cancel := context.WithTimeout(context.Background(), qaTimeout)
			defer cancel()
			script := "../../apps/video/scripts/media-native-authority-check.mjs"
			apple := product == "video" && (platform == "ios" || platform == "macos") && os.Getenv("YNX_QA_APPLE_VIDEO_ENGINE_BIN") != ""
			if apple {
				script = "../../apps/video/scripts/media-apple-authority-check.mjs"
			}
			creatorApple := product == "creator-studio" && (platform == "ios" || platform == "macos") && os.Getenv("YNX_QA_APPLE_CREATOR_ENGINE_BIN") != ""
			if creatorApple {
				script = "../../apps/creator-studio/scripts/apple-native-authority-check.mjs"
			}
			cmd := exec.CommandContext(ctx, "node", script, source, product, platform)
			cmd.Env = append(os.Environ(), "YNX_QA_NATIVE_MEDIA_KEY="+nativeMediaKey, "YNX_QA_NATIVE_VIDEO_ID="+nativeVideoID, "YNX_QA_ORIGINAL_MEDIA_URL="+server.URL, "YNX_QA_PUBLIC_KEY="+string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})))
			var output, diagnostic bytes.Buffer
			cmd.Stdout = &output
			cmd.Stderr = &diagnostic
			if e = cmd.Run(); e != nil {
				t.Fatalf("actual native consumer/original business failed: %v %s", e, diagnostic.String())
			}
			var receipt struct {
				PlaybackID                    string `json:"playbackID"`
				ActualBusinessServerReadback  bool   `json:"actualBusinessServerReadback"`
				ActualAppleSwiftWebKitEngine  bool   `json:"actualAppleSwiftWebKitEngine"`
				ActualOriginalAppleModelFlow  bool   `json:"actualOriginalAppleModelFlow"`
				ActualTwoOriginalSwiftActors  bool   `json:"actualTwoOriginalSwiftActors"`
				ActualIndependentReview       bool   `json:"actualIndependentRightsAndPublication"`
				ActualPublicationRecovery     bool   `json:"actualScheduledPublicationRecovery"`
				ActualRevokedTeamDenied       bool   `json:"actualRevokedTeamMutationDenied"`
				ActualAppealColdRecovery      bool   `json:"actualAppealColdRecovery"`
				ActualAppealFreshReview       bool   `json:"actualAppealRequiresFreshPublicationReview"`
				ActualAssetColdRecovery       bool   `json:"actualAssetColdRecovery"`
				ActualAssetOriginalReadback   bool   `json:"actualAssetOriginalByteReadback"`
				ActualAIStreamRecovery        bool   `json:"actualAIStreamAndColdRecovery"`
				ActualAICancelBoundary        bool   `json:"actualAICancelAndHumanBoundary"`
				ActualRepeatedOriginalRestore bool   `json:"actualRepeatedOriginalRestore"`
				ActualNativeUploadExpiry      bool   `json:"actualNativeUploadExpiry"`
				ActualCapturedButtonAuthority bool   `json:"actualCapturedButtonAuthority"`
				ActualNativeHistoryExpiry     bool   `json:"actualRetainedNativeHistoryAndExpiry"`
				ActualRightsFullFields        bool   `json:"actualNativeRightsFullFields"`
				ActualDelegatedFinance        bool   `json:"actualDelegatedFinanceRecovery"`
				ActualWalletConsent           bool   `json:"actualWalletConsent"`
				QAProtectedPorts              bool   `json:"qaProtectedPorts"`
			}
			if json.Unmarshal(output.Bytes(), &receipt) != nil || !receipt.ActualBusinessServerReadback || receipt.ActualWalletConsent || !receipt.QAProtectedPorts || (apple || creatorApple) && (!receipt.ActualAppleSwiftWebKitEngine || !receipt.ActualOriginalAppleModelFlow) {
				t.Fatal("native consumer receipt gates invalid")
			}
			if creatorApple && (!receipt.ActualTwoOriginalSwiftActors || !receipt.ActualIndependentReview || !receipt.ActualPublicationRecovery || !receipt.ActualRevokedTeamDenied || !receipt.ActualAppealColdRecovery || !receipt.ActualAppealFreshReview || !receipt.ActualAssetColdRecovery || !receipt.ActualAssetOriginalReadback || !receipt.ActualAIStreamRecovery || !receipt.ActualAICancelBoundary || !receipt.ActualRightsFullFields || !receipt.ActualDelegatedFinance || !receipt.ActualCapturedButtonAuthority || !receipt.ActualNativeHistoryExpiry || !receipt.ActualNativeUploadExpiry || !receipt.ActualRepeatedOriginalRestore) {
				t.Fatal("missing original Creator two-actor review, publication recovery, or revoked-team evidence")
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
				history, e := owned.History(actor.Account)
				expectedPlayback := "00000000-0000-4000-8000-000000000001"
				if apple {
					expectedPlayback = receipt.PlaybackID
					if expectedPlayback == "" {
						t.Fatal("missing original persisted Apple playback ID")
					}
				}
				if e != nil || len(history) != 1 || history[0].PlaybackID != expectedPlayback || history[0].Seconds != 7 {
					t.Fatal("missing original Native playback history")
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
				if creatorApple {
					studio, err := owned.Studio(actor.Account)
					if err != nil || len(studio.Videos) != 1 || studio.Videos[0].Owner != actor.Account || studio.Videos[0].WorkflowState != WorkflowPublished || studio.Videos[0].Visibility != VisibilityPublic {
						t.Fatal("missing exact original Creator upload and independent-review readback")
					}
					if len(studio.Reports) != 1 || len(studio.Appeals) != 1 || studio.Appeals[0].Appellant != actor.Account || studio.Appeals[0].State != "accepted" || studio.Reports[0].State != "appeal_accepted" || studio.Appeals[0].ReportID != studio.Reports[0].ID || len(studio.Disputes) != 1 {
						t.Fatal("missing original single recovered owner appeal and independent human acceptance")
					}
					if len(studio.Revenue) != 1 || studio.Revenue[0].Owner != actor.Account || studio.Disputes[0].Owner != actor.Account || studio.Disputes[0].RevenueRecordID != studio.Revenue[0].ID || len(studio.PayoutIntents) != 0 {
						t.Fatal("missing original owner revenue/delegated dispute or finance redirected payout")
					}
					if len(studio.AIJobs) != 0 || aiStarts.Load() != 3 {
						t.Fatal("AI recovery reran provider or original tasks/results were not explicitly deleted")
					}
					original := studio.Videos[0]
					if original.ThumbnailKey == "" || len(original.Captions) != 1 || !original.Captions[0].HumanApproved || original.Captions[0].AIProposed {
						t.Fatal("missing original single thumbnail and human-approved caption after cold recovery")
					}
					for _, key := range []string{original.ThumbnailKey, original.Captions[0].ObjectKey} {
						path, err := owned.MediaPath(actor.Account, key)
						if err != nil {
							t.Fatal(err)
						}
						bytes, err := os.ReadFile(path)
						if err != nil || len(bytes) == 0 {
							t.Fatal("missing original asset bytes")
						}
					}
					if original.Rights == nil || original.Rights.ExpiresAt == nil {
						t.Fatal("missing original upload rights expiry")
					}
					if original.ReviewedBy != creatorModerator || original.SubmittedBy == original.ReviewedBy || len(actors) != 2 {
						t.Fatal("missing two exact original SDK actors and independent publication reviewer")
					}
					if len(studio.Rights) != 1 || studio.Rights[0].State != "verified" || studio.Rights[0].Reviewer != creatorModerator || !studio.Rights[0].Exclusive || studio.Rights[0].StartsAt == nil || studio.Rights[0].EndsAt == nil || len(studio.Rights[0].ContributorSplits) != 2 {
						t.Fatal("missing independently reviewed original rights")
					}
					team, err := owned.Team(actor.Account, original.ChannelID)
					if err != nil {
						t.Fatal(err)
					}
					for _, member := range team.Members {
						if member.Account == creatorModerator && member.State != "revoked" {
							t.Fatal("original moderator access was not revoked")
						}
					}
				}
			}
			t.Log("actual NativeSDK + owned native consumer + original business + context/cold/revoke; software QA ports, no installed OS or real Wallet claim")
		})
	}
}
