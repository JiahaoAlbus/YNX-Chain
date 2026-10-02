package social

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

type independentUnknownAuthority struct{ calls int }

func (a *independentUnknownAuthority) ConfirmAudience(context.Context, MatrixAudienceMetadata, string) (MatrixAudienceObservation, error) {
	a.calls++
	return MatrixAudienceObservation{}, errors.New("synthetic remote room created but response lost")
}
func (a *independentUnknownAuthority) ObserveEvent(context.Context, string, string) (MatrixAudienceEvent, error) {
	return MatrixAudienceEvent{}, errors.New("not called")
}
func TestIndependentAudienceUnknownIntentFreshNonceAfterRestart(t *testing.T) {
	s, actor, _, _ := audienceFixture(t)
	a := &independentUnknownAuthority{}
	s.cfg.MatrixAudienceAuthority = a
	selection := MatrixAudienceSelection{Kind: "private"}
	r := &MatrixAudienceActionReceipt{Nonce: "independent_original_nonce_01", BodyDigest: "same_exact_body", SessionBinding: "original_session", ExpiresAt: s.cfg.Now().Add(time.Minute)}
	if _, e := s.resolveMatrixAudience(context.Background(), actor, selection, r); e == nil {
		t.Fatal("expected unknown outcome")
	}
	if len(s.state.MatrixAudienceNonces) != 1 {
		t.Fatal("prepared intent lost")
	}
	restarted, e := New(s.cfg)
	if e != nil {
		t.Fatal(e)
	}
	r.Nonce = "independent_fresh_nonce_02"
	_, e = restarted.resolveMatrixAudience(context.Background(), actor, selection, r)
	if a.calls != 1 {
		t.Fatalf("fresh nonce same actor/selection/body repeated unknown room side effect after restart: calls=%d result=%v", a.calls, e)
	}
}
func TestIndependentAudienceUnknownExpiredLedgerAndCapacity(t *testing.T) {
	s, actor, _, _ := audienceFixture(t)
	a := &independentUnknownAuthority{}
	s.cfg.MatrixAudienceAuthority = a
	now := s.cfg.Now()
	s.cfg.Now = func() time.Time { return now }
	r := &MatrixAudienceActionReceipt{Nonce: "independent_unknown_nonce_01", BodyDigest: "digest", SessionBinding: "session", ExpiresAt: now.Add(time.Second)}
	s.resolveMatrixAudience(context.Background(), actor, MatrixAudienceSelection{Kind: "private"}, r)
	now = now.Add(time.Minute)
	s.cfg.MatrixAudienceAuthority = &syntheticAudienceAuthority{}
	r.Nonce = "independent_new_nonce_02"
	r.ExpiresAt = now.Add(time.Minute)
	if _, e := s.resolveMatrixAudience(context.Background(), actor, MatrixAudienceSelection{Kind: "contacts"}, r); e != nil {
		t.Fatal(e)
	}
	prepared := 0
	for _, v := range s.state.MatrixAudienceNonces {
		if v.Status == "prepared" {
			prepared++
		}
	}
	if prepared != 1 {
		t.Fatal("unknown expired intent pruned")
	}
	before := cloneState(s.state)
	for len(s.state.MatrixAudienceNonces) < 4096 {
		k := strings.Repeat("x", len(s.state.MatrixAudienceNonces)+1)
		s.state.MatrixAudienceNonces[k] = matrixAudienceNonce{Status: "prepared", ExpiresAt: now.Add(-time.Hour)}
	}
	if e := s.saveOrRollbackLocked(before); e != nil {
		t.Fatal(e)
	}
	r.Nonce = "independent_full_nonce_03"
	if _, e := s.resolveMatrixAudience(context.Background(), actor, MatrixAudienceSelection{Kind: "private"}, r); !errors.Is(e, ErrRateLimited) {
		t.Fatalf("full ledger admitted new intent %v", e)
	}
}
func TestIndependentAudienceBrowserGrantRevokedDuringObservation(t *testing.T) {
	s, actor, _, observer := audienceFixture(t)
	s.cfg.Now = func() time.Time { return time.Now().UTC() }
	s.cfg.RateLimitMax = 100
	revoked := false
	checks := 0
	identityExpiry := time.Now().Add(time.Hour)
	grantExpiry := time.Now().Add(5 * time.Minute)
	observations := 0
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
	observer.observe = func(MatrixAudienceMetadata) { observations++; revoked = true }
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
	if observations != 1 {
		t.Fatalf("browser fixture did not reach observer: code=%d checks=%d body=%s", w.Code, checks, w.Body.String())
	}
	if w.Code == 200 || len(s.state.MatrixAudiences) != 0 {
		t.Fatalf("revoked browser grant returned and persisted private room: status=%d checks=%d bindings=%d", w.Code, checks, len(s.state.MatrixAudiences))
	}
}

type independentUnknownIndex struct{ calls int }

func (a *independentUnknownIndex) ConfirmAudience(_ context.Context, m MatrixAudienceMetadata, _ string) (MatrixAudienceObservation, error) {
	return MatrixAudienceObservation{m.RoomID, m.Members, "m.megolm.v1.aes-sha2", "joined"}, nil
}
func (a *independentUnknownIndex) ObserveEvent(context.Context, string, string) (MatrixAudienceEvent, error) {
	a.calls++
	return MatrixAudienceEvent{}, errors.New("synthetic private event read succeeded but response lost")
}
func TestIndependentAudienceUnknownIndexFreshNonceAfterRestart(t *testing.T) {
	s, actor, _, _ := audienceFixture(t)
	metadata, e := s.ResolveMatrixAudience(context.Background(), actor, MatrixAudienceSelection{Kind: "private"})
	if e != nil {
		t.Fatal(e)
	}
	a := &independentUnknownIndex{}
	s.cfg.MatrixAudienceAuthority = a
	in := matrixAudienceAuthorize{Action: "index", TransactionID: "original_index_transaction_001", Expected: metadata, EventID: "$original-event"}
	r := &MatrixAudienceActionReceipt{Nonce: "independent_index_nonce_01", BodyDigest: "same_index_body", SessionBinding: "original_session", ExpiresAt: s.cfg.Now().Add(time.Minute)}
	if _, e = s.authorizeMatrixAudience(context.Background(), actor, in, r); e == nil {
		t.Fatal("unknown index outcome missing")
	}
	restarted, e := New(s.cfg)
	if e != nil {
		t.Fatal(e)
	}
	r.Nonce = "independent_index_nonce_02"
	_, e = restarted.authorizeMatrixAudience(context.Background(), actor, in, r)
	if a.calls != 1 {
		t.Fatalf("fresh nonce repeated original private event read with same actor/txn/body: calls=%d result=%v", a.calls, e)
	}
}

type independentReadSpy struct {
	confirm func()
	reads   int
	event   MatrixAudienceEvent
}

func (a *independentReadSpy) ConfirmAudience(_ context.Context, m MatrixAudienceMetadata, _ string) (MatrixAudienceObservation, error) {
	if a.confirm != nil {
		a.confirm()
	}
	return MatrixAudienceObservation{m.RoomID, m.Members, "m.megolm.v1.aes-sha2", "joined"}, nil
}
func (a *independentReadSpy) ObserveEvent(context.Context, string, string) (MatrixAudienceEvent, error) {
	a.reads++
	return a.event, nil
}
func TestIndependentAudienceLatePolicyChangeCannotReachPrivateEventRead(t *testing.T) {
	s, actor, peer, _ := audienceFixture(t)
	m, e := s.ResolveMatrixAudience(context.Background(), actor, MatrixAudienceSelection{Kind: "contacts"})
	if e != nil {
		t.Fatal(e)
	}
	spy := &independentReadSpy{event: MatrixAudienceEvent{m.RoomID, "$parent-event", m.Owner, "m.room.encrypted", "original_transaction_001"}}
	s.cfg.MatrixAudienceAuthority = spy
	spy.confirm = func() {
		if e := s.Block(Session{Account: actor}, peer); e != nil {
			t.Fatal(e)
		}
	}
	_, e = s.authorizeMatrixAudience(context.Background(), actor, matrixAudienceAuthorize{Action: "index", TransactionID: "original_transaction_001", Expected: m, EventID: "$parent-event"}, &MatrixAudienceActionReceipt{Nonce: "independent_latepolicy_nonce", BodyDigest: "body", SessionBinding: "session", ExpiresAt: s.cfg.Now().Add(time.Minute)})
	if e == nil || spy.reads != 0 {
		t.Fatalf("late persisted block reached private event observer before current policy check: reads=%d final=%v", spy.reads, e)
	}
}
func TestIndependentAudienceWrongActorIndexCannotReachPrivateEventRead(t *testing.T) {
	s, actor, peer, _ := audienceFixture(t)
	m, e := s.ResolveMatrixAudience(context.Background(), actor, MatrixAudienceSelection{Kind: "contacts"})
	if e != nil {
		t.Fatal(e)
	}
	peerID, _ := s.cfg.MatrixDirectory.Resolve(peer)
	spy := &independentReadSpy{event: MatrixAudienceEvent{m.RoomID, "$peer-event", peerID.UserID, "m.room.encrypted", "wrongactor_transaction_001"}}
	s.cfg.MatrixAudienceAuthority = spy
	_, e = s.authorizeMatrixAudience(context.Background(), peer, matrixAudienceAuthorize{Action: "index", TransactionID: "wrongactor_transaction_001", Expected: m, EventID: "$peer-event"}, &MatrixAudienceActionReceipt{Nonce: "independent_wrongactor_nonce", BodyDigest: "body", SessionBinding: "session", ExpiresAt: s.cfg.Now().Add(time.Minute)})
	if !errors.Is(e, ErrUnauthorized) || spy.reads != 0 {
		t.Fatalf("nonowner original post index reached private event observer before actor check: reads=%d final=%v", spy.reads, e)
	}
}
func TestIndependentAudienceMissingHSAdapterIsUnavailable(t *testing.T) {
	s, actor, _, _ := audienceFixture(t)
	s.cfg.MatrixAudienceAuthority = nil
	s.cfg.ProductSessions = map[string]ProductSessionAuthorizer{"native": &audienceProofSpy{account: actor, approved: []string{"social.contacts", "social.feed", "social.messaging", "social.profile"}}}
	s.cfg.MatrixAudienceActionVerifier = &syntheticAudienceActionVerifier{}
	r := httptest.NewRequest("POST", "/social/v3/matrix/audience/resolve", bytes.NewBufferString(`{"kind":"private"}`))
	r.Header.Set(productsessionv2.ProofHeader, base64.RawURLEncoding.EncodeToString([]byte(`{"platform":"native"}`)))
	r.Header.Set("X-YNX-Product-Session-Action-Proof-V2", "synthetic-only")
	w := httptest.NewRecorder()
	(&Server{service: s}).Handler().ServeHTTP(w, r)
	if w.Code != 503 {
		t.Fatalf("missing HS production adapter should503, got%d %s", w.Code, w.Body.String())
	}
}
