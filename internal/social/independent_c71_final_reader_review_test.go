package social

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestIndependentC71BrowserRevokedInsideFinalReader(t *testing.T) {
	s, actor, _, observer := audienceFixture(t)
	s.cfg.Now = func() time.Time { return time.Now().UTC() }
	s.cfg.RateLimitMax = 100
	revoked := false
	checks := 0
	identityExpiry := time.Now().Add(time.Hour)
	grantExpiry := time.Now().Add(5 * time.Minute)
	observations := 0
 readerCalls:=0
	transport := bridgeTransport(func(r *http.Request) (*http.Response, error) {
		status := 200
		var body any = productsessionv2.BrowserGrant{GrantToken: strings.Repeat("g", 43), Identity: productsessionv2.BrowserIdentity{Subject: actor, Account: actor, Generation: 1, ExpiresAt: identityExpiry}, Audience: "ynx:social:identity", Scopes: []string{"identity:read"}, ExpiresAt: grantExpiry}
		if r.URL.Path != "/v2/browser-sessions/token" {
			checks++
			if revoked {
				status = 401
				body = map[string]bool{"active": false}
			}
		}
		b, _ := json.Marshal(body)
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(bytes.NewReader(b))}, nil
	})
	bridge, e := productsessionv2.NewBrowserSSO("social", "https://wallet-auth.ynxweb4.com", bytes.Repeat([]byte{9}, 32), []string{"conversations"}, transport)
	if e != nil {
		t.Fatal(e)
	}
	start := httptest.NewRecorder()
	bridge.Start(start, httptest.NewRequest("GET", Origin+"/sso/start", nil))
	redirect, _ := url.Parse(start.Header().Get("Location"))
	callback := httptest.NewRequest("GET", Origin+"/sso/callback?state="+redirect.Query().Get("state")+"&code="+strings.Repeat("c", 43), nil)
	for _, c := range start.Result().Cookies() {
		callback.AddCookie(c)
	}
	completed := httptest.NewRecorder()
	bridge.Callback(completed, callback)
	if completed.Code != 303 {
		t.Fatal("fixture callback", completed.Code)
	}
	s.cfg.BrowserSSO = bridge
	s.cfg.ProductSessions = map[string]ProductSessionAuthorizer{"web": &bridgeAuthority{session: productsessionv2.Session{Platform: "web", SessionBinding: "synthetic-session", ProductID: RequestingProduct, ClientID: ProductClientID, Account: actor, ExpiresAt: time.Now().Add(time.Minute).Format(time.RFC3339Nano), Scopes: []string{"social.contacts", "social.feed", "social.messaging", "social.profile"}}}}
	s.cfg.MatrixAudienceActionVerifier = &syntheticAudienceActionVerifier{}
	observer.observe = func(MatrixAudienceMetadata) { observations++ }
 s.cfg.MatrixAudienceSessionRevalidator = syntheticAudienceRevalidator{run:func(_ context.Context, original productsessionv2.Session, _ []string)(productsessionv2.Session,error){readerCalls++;if readerCalls==2 {revoked=true};return original,nil}}
	r := httptest.NewRequest("POST", "/social/v3/matrix/audience/resolve", bytes.NewBufferString(`{"kind":"private"}`))
	r.Header.Set(productsessionv2.ProofHeader, base64.RawURLEncoding.EncodeToString([]byte(`{"platform":"web"}`)))
	r.Header.Set("X-YNX-Product-Session-Action-Proof-V2", "synthetic-only")
	for _, c := range completed.Result().Cookies() {
		if c.MaxAge != -1 {
			r.AddCookie(c)
		}
	}
	_, grant, e := bridge.Binding(r)
	if e != nil {
		t.Fatal(e)
	}
	r.Header.Set("Origin", Origin)
	r.Header.Set("X-YNX-SSO-CSRF", grant.CSRF)
	w := httptest.NewRecorder()
	(&Server{service: s}).Handler().ServeHTTP(w, r)
 if w.Code != 401 || observations != 1 || readerCalls!=2 || len(s.state.MatrixAudiences)!=0 {t.Fatalf("browser revoked inside final confidential reader still committed: status=%d observations=%d checks=%d readers=%d bindings=%d nonces=%d",w.Code,observations,checks,readerCalls,len(s.state.MatrixAudiences),len(s.state.MatrixAudienceNonces))}
}
