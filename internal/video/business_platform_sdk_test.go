//go:build ynx_canonical_media && ynx_media_combined_authority

package video

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type rejectedPlatformAuthority struct {
	calls   *int
	failure error
}

func (a rejectedPlatformAuthority) VerifyVideoBusiness(context.Context, *http.Request, string, io.Reader, int64) (VideoBusinessGrant, error) {
	*a.calls++
	return VideoBusinessGrant{}, a.failure
}
func TestOriginalVideoPlatformRoutingNeverFallsBackOnRefusal(t *testing.T) {
	refusal := errors.New("original authority refused")
	webCalls, nativeCalls := 0, 0
	authority, err := NewVideoPlatformSDKAuthority(rejectedPlatformAuthority{&webCalls, refusal}, rejectedPlatformAuthority{&nativeCalls, refusal})
	if err != nil {
		t.Fatal(err)
	}
	for _, platform := range []string{"web", "android", "ios", "macos"} {
		application := "com.ynxweb4.video"
		claim := videoSessionV2{Version: "2", ChainID: "ynx_6423-1", ProductID: "video", ClientID: "ynx-video-mobile-v1", Platform: platform, ApplicationID: application + ".web", Origin: "https://video.ynxweb4.com", Callback: "https://video.ynxweb4.com/wallet-auth/callback"}
		if platform != "web" {
			claim.ApplicationID = application
			claim.Origin = "app://" + platform + "/" + application
			claim.Callback = "ynxvideo://wallet-auth/callback"
			if platform == "android" {
				claim.PackageID = &application
			} else {
				claim.BundleID = &application
			}
		}
		raw, _ := json.Marshal(claim)
		request := httptest.NewRequest("GET", "https://video.ynxweb4.com/v1/account", nil)
		request.Header.Set(productSessionProofV2Header, base64.RawURLEncoding.EncodeToString(raw))
		if _, e := authority.VerifyVideoBusiness(context.Background(), request, "video:account", strings.NewReader(""), 0); !errors.Is(e, refusal) {
			t.Fatalf("%s: %v", platform, e)
		}
	}
	if webCalls != 1 || nativeCalls != 3 {
		t.Fatalf("unexpected fallback web=%d native=%d", webCalls, nativeCalls)
	}
	malformed := httptest.NewRequest("GET", "https://video.ynxweb4.com/v1/account", nil)
	if _, e := authority.VerifyVideoBusiness(context.Background(), malformed, "video:account", strings.NewReader(""), 0); e == nil {
		t.Fatal("missing route tuple accepted")
	}
	if webCalls != 1 || nativeCalls != 3 {
		t.Fatal("malformed tuple reached a factory")
	}
}
