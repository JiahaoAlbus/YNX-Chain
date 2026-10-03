//go:build ynx_canonical_media

package video

import (
	"crypto/rand"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

func TestMediaApprovedBrowserConstructorBindings(t *testing.T) {
	if os.Getenv("YNX_QA_MEDIA_APPROVED_BROWSER_ROSTER") != "1" {
		t.Skip("requires independently pinned approved258 overlay")
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ product, client, origin string }{{"video", "ynx-video-mobile-v1-sso-v1", "https://video.ynxweb4.com"}, {"creator-studio", "ynx-creator-studio-web-v1-sso-v1", "https://creator.ynxweb4.com"}} {
		t.Run(tc.product, func(t *testing.T) {
			sso, err := productsessionv2.NewBrowserSSO(tc.product, "https://wallet-auth.ynxweb4.com", key, []string{"home"}, nil)
			if err != nil {
				t.Fatal(err)
			}
			out := httptest.NewRecorder()
			sso.Start(out, httptest.NewRequest("GET", tc.origin+"/sso/start?target=home", nil))
			location, err := url.Parse(out.Header().Get("Location"))
			if err != nil {
				t.Fatal(err)
			}
			q := location.Query()
			if out.Code != 303 || location.Scheme+"://"+location.Host+location.Path != "https://wallet-auth.ynxweb4.com/v2/browser-sessions/authorize" || q.Get("clientId") != tc.client || q.Get("origin") != tc.origin || q.Get("redirectUri") != tc.origin+"/sso/callback" || q.Get("codeChallengeMethod") != "S256" || q.Get("state") == "" || q.Get("codeChallenge") == "" {
				t.Fatal("registered original identity tuple or PKCE lost")
			}
			if q.Get("redirectUri") == tc.origin+"/wallet-auth/callback" {
				t.Fatal("identity callback replaced private approval callback")
			}
			if len(out.Result().Cookies()) == 0 || out.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing original sealed pending cookie/no-store")
			}
		})
	}
	for _, product := range []string{"music", "card", "pay-merchant", "merchant", "seller"} {
		if _, err := productsessionv2.NewBrowserSSO(product, "https://wallet-auth.ynxweb4.com", key, []string{"home"}, nil); err == nil {
			t.Fatal("unregistered identity admitted:", product)
		}
	}
}
