package video

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func creatorV2Fixture() videoSessionV2 {
	return videoSessionV2{
		Version: "2", ChainID: "ynx_6423-1", SessionBinding: "ps_qa_session_0001",
		ProductID: "creator-studio", ClientID: "ynx-creator-studio-web-v1", Platform: "web",
		ApplicationID: "com.ynxweb4.creator-studio.web", Origin: "https://creator.ynxweb4.com",
		Callback: "https://creator.ynxweb4.com/wallet-auth/callback", Account: gatewayTestAccount,
		DeviceID: "qa-device", DeviceKey: "qa-public-key", Scopes: []string{"creator:publish"},
		ExpiresAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano),
	}
}

func encodedV2Fixture(session videoSessionV2) string {
	raw, _ := json.Marshal(session)
	return base64.RawURLEncoding.EncodeToString(raw)
}

// Cryptographic validation is the real gateway's responsibility. These cases
// exercise the consumer's independent scope and returned-authority checks.
func TestCreatorV2IntrospectionContractAndReturnedBindings(t *testing.T) {
	cases := map[string]func(*videoSessionV2){
		"valid":             nil,
		"different product": func(s *videoSessionV2) { s.ProductID = "video" },
		"different device":  func(s *videoSessionV2) { s.DeviceKey = "other-device-key" },
		"different session": func(s *videoSessionV2) { s.SessionBinding = "other-session" },
		"wrong chain":       func(s *videoSessionV2) { s.ChainID = "ynx_1-1" },
		"wrong platform":    func(s *videoSessionV2) { s.Platform = "android" },
		"scope missing":     func(s *videoSessionV2) { s.Scopes = []string{"creator:account"} },
		"double web suffix": func(s *videoSessionV2) { s.ApplicationID += ".web" },
		"wrong callback":    func(s *videoSessionV2) { s.Callback += "/other" },
		"expired":           func(s *videoSessionV2) { s.ExpiresAt = time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano) },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			claimed := creatorV2Fixture()
			gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				if r.URL.Path != "/v2/product-sessions/introspect" || r.Method != "POST" || string(body) != `{"requiredScopes":["creator:publish"]}` ||
					r.Header.Get("Origin") != claimed.Origin || r.Header.Get("Content-Type") != "application/json" ||
					r.Header.Get(productSessionProofV2Header) != encodedV2Fixture(claimed) || !strings.HasPrefix(r.Header.Get("X-Request-ID"), "req_video_") {
					t.Error("consumer changed the signed introspection contract")
				}
				returned := claimed
				if mutate != nil {
					mutate(&returned)
				}
				requestID := r.Header.Get("X-Request-ID")
				w.Header().Set("X-Request-ID", requestID)
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "schemaVersion": 2, "requestId": requestID,
					"result": map[string]any{"active": true, "session": returned}})
			}))
			defer gateway.Close()
			auth := CentralProductSessionAuth{GatewayURL: gateway.URL, Client: gateway.Client()}
			r := httptest.NewRequest("POST", "/v1/uploads", nil)
			r.Header.Set(productSessionProofV2Header, encodedV2Fixture(claimed))
			r.Header.Set("Origin", claimed.Origin)
			account, err := auth.Account(r)
			if name == "valid" && (err != nil || account != gatewayTestAccount) {
				t.Fatalf("valid session rejected: %v", err)
			}
			if name != "valid" && err == nil {
				t.Fatal("invalid returned authority accepted")
			}
		})
	}
}

func TestCreatorV2RejectsMixedProofAndCrossOriginBeforeGateway(t *testing.T) {
	for _, invalid := range []string{"mixed", "cross-origin"} {
		t.Run(invalid, func(t *testing.T) {
			gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("invalid input reached gateway") }))
			defer gateway.Close()
			request := httptest.NewRequest("POST", "/v1/channels", nil)
			request.Header.Set(productSessionProofV2Header, encodedV2Fixture(creatorV2Fixture()))
			if invalid == "mixed" {
				request.Header.Set("X-YNX-Product-Session-Proof", "legacy")
			} else {
				request.Header.Set("Origin", "https://video.ynxweb4.com")
			}
			if _, err := (CentralProductSessionAuth{GatewayURL: gateway.URL}).Account(request); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
}

func TestVideoV2CannotAuthorizeCreatorWrites(t *testing.T) {
	if videoProductScopeV2("video", "POST", "/v1/uploads") != "" {
		t.Fatal("viewer scope authorizes upload")
	}
	if videoProductScopeV2("creator-studio", "POST", "/v1/videos/id/review-publication") != "creator:publish" {
		t.Fatal("review scope incorrect")
	}
	if videoProductScopeV2("creator-studio", "GET", "/v1/studio") != "creator:account" {
		t.Fatal("studio read scope incorrect")
	}
	if videoProductScopeV2("creator-studio", "POST", "/v1/studio/payout-intents") != "creator:revenue" {
		t.Fatal("payout scope incorrect")
	}
}

func TestVideoV2ViewerRoutesHaveExactScopes(t *testing.T) {
	cases := []struct{ method, path, scope string }{
		{"GET", "/v1/videos", "video:playback"}, {"GET", "/v1/videos/vid_one", "video:playback"},
		{"GET", "/v1/videos/vid_one/comments", "video:playback"}, {"GET", "/v1/channels/chn_one", "video:playback"},
		{"HEAD", "/media/vid_one/original", "video:playback"}, {"GET", "/v1/history", "video:library"},
		{"GET", "/v1/playlists", "video:library"}, {"GET", "/v1/subscriptions", "video:library"},
		{"POST", "/v1/playlists", "video:library"}, {"POST", "/v1/playlists/pl_one/videos", "video:library"},
		{"DELETE", "/v1/playlists/pl_one", "video:library"}, {"DELETE", "/v1/playlists/pl_one/videos/vid_one", "video:library"},
		{"POST", "/v1/videos/vid_one/watch", "video:library"}, {"POST", "/v1/channels/chn_one/subscription", "video:library"},
		{"DELETE", "/v1/channels/chn_one/subscription", "video:library"},
		{"POST", "/v1/videos/vid_one/comments", "video:account"}, {"POST", "/v1/videos/vid_one/reports", "video:account"},
		{"POST", "/v1/reports/report_one/appeals", "video:account"}, {"DELETE", "/v1/privacy/account-data", "video:account"},
	}
	for _, item := range cases {
		t.Run(item.method+item.path, func(t *testing.T) {
			if scope := videoProductScopeV2("video", item.method, item.path); scope != item.scope {
				t.Fatalf("scope=%q, want %q", scope, item.scope)
			}
			claimed := creatorV2Fixture()
			claimed.ProductID, claimed.ClientID, claimed.ApplicationID = "video", "ynx-video-mobile-v1", "com.ynxweb4.video.web"
			claimed.Origin, claimed.Callback = "https://video.ynxweb4.com", "https://video.ynxweb4.com/wallet-auth/callback"
			claimed.Scopes = []string{item.scope}
			gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				if string(body) != `{"requiredScopes":["`+item.scope+`"]}` {
					t.Error("signed introspection scope changed")
				}
				requestID := r.Header.Get("X-Request-ID")
				w.Header().Set("X-Request-ID", requestID)
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "schemaVersion": 2, "requestId": requestID,
					"result": map[string]any{"active": true, "session": claimed}})
			}))
			defer gateway.Close()
			request := httptest.NewRequest(item.method, item.path, nil)
			request.Header.Set(productSessionProofV2Header, encodedV2Fixture(claimed))
			request.Header.Set("Origin", claimed.Origin)
			if account, err := (CentralProductSessionAuth{GatewayURL: gateway.URL}).Account(request); err != nil || account != gatewayTestAccount {
				t.Fatalf("valid viewer route rejected: %v", err)
			}
		})
	}
}

func TestVideoV2RejectsCreatorAndUnsupportedRoutesBeforeGateway(t *testing.T) {
	claimed := creatorV2Fixture()
	claimed.ProductID, claimed.ClientID, claimed.ApplicationID = "video", "ynx-video-mobile-v1", "com.ynxweb4.video.web"
	claimed.Origin, claimed.Callback = "https://video.ynxweb4.com", "https://video.ynxweb4.com/wallet-auth/callback"
	claimed.Scopes = []string{"video:account", "video:library", "video:playback"}
	for _, item := range []struct{ method, path string }{
		{"GET", "/v1/studio"}, {"GET", "/v1/studio/analytics"}, {"GET", "/v1/channels/chn_one/team"},
		{"GET", "/v1/videos/vid_one/rights"}, {"GET", "/v1/ai/providers"}, {"GET", "/v1/studio/revenue"},
		{"POST", "/v1/uploads"}, {"POST", "/v1/channels"}, {"POST", "/v1/videos/vid_one/publish"},
		{"POST", "/v1/videos/vid_one/review-publication"}, {"POST", "/v1/reports/report_one/moderate"},
		{"DELETE", "/v1/channels/chn_one/team/account"}, {"DELETE", "/v1/videos/vid_one"},
		{"GET", "/v1/studio/history"}, {"POST", "/v1/playlists/../../uploads"}, {"POST", "/v1/wallet/revoke"},
	} {
		t.Run(item.method+item.path, func(t *testing.T) {
			gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("unsupported Video authority reached Gateway") }))
			defer gateway.Close()
			request := httptest.NewRequest(item.method, item.path, nil)
			request.Header.Set(productSessionProofV2Header, encodedV2Fixture(claimed))
			request.Header.Set("Origin", claimed.Origin)
			if _, err := (CentralProductSessionAuth{GatewayURL: gateway.URL}).Account(request); err == nil {
				t.Fatal("Video session accessed a Creator or unsupported route")
			}
		})
	}
}
