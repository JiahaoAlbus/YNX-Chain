package social

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// This spy verifies the new route's exact input to the existing authorizer;
// it is not a real signed device-proof or BrowserSSO acceptance test.
type audienceProofSpy struct {
	account  string
	body     []byte
	scopes   []string
	approved []string
}

type syntheticAudienceActionVerifier struct {
	body   []byte
	scopes []string
}

// Explicit test dependency only. Production Config defaults to nil/503 and
// must use A's approved confidential reader; this is not Native acceptance.
type syntheticAudienceRevalidator struct {
	run func(context.Context, productsessionv2.Session, []string) (productsessionv2.Session, error)
}

func (v syntheticAudienceRevalidator) Revalidate(ctx context.Context, original productsessionv2.Session, scopes []string) (productsessionv2.Session, error) {
	if v.run != nil {
		return v.run(ctx, original, scopes)
	}
	return original, nil
}

func TestMatrixAudienceMissingConfidentialReaderCannotObserveOrReserveNonce(t *testing.T) {
	s, actor, _, authority := audienceFixture(t)
	s.cfg.MatrixAudienceSessionRevalidator = nil
	s.cfg.ProductSessions = map[string]ProductSessionAuthorizer{"native": &audienceProofSpy{account: actor, approved: []string{"social.contacts", "social.feed", "social.messaging", "social.profile"}}}
	s.cfg.MatrixAudienceActionVerifier = &syntheticAudienceActionVerifier{}
	observations := 0
	authority.observe = func(MatrixAudienceMetadata) { observations++ }
	r := httptest.NewRequest(http.MethodPost, "/social/v3/matrix/audience/resolve", bytes.NewBufferString(`{"kind":"private"}`))
	r.Header.Set(productsessionv2.ProofHeader, base64.RawURLEncoding.EncodeToString([]byte(`{"platform":"native"}`)))
	r.Header.Set("X-YNX-Product-Session-Action-Proof-V2", "synthetic-action")
	w := httptest.NewRecorder()
	(&Server{service: s}).Handler().ServeHTTP(w, r)
	if w.Code != 503 || observations != 0 || len(s.state.MatrixAudienceNonces) != 0 {
		t.Fatal("missing server reader reached protected work", w.Code, observations)
	}
}

func TestMatrixAudienceAfterAwaitConfidentialReadRejectionKeepsOriginalUnknownIntent(t *testing.T) {
	for _, status := range []int{401, 403, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			s, actor, _, authority := audienceFixture(t)
			s.cfg.ProductSessions = map[string]ProductSessionAuthorizer{"native": &audienceProofSpy{account: actor, approved: []string{"social.contacts", "social.feed", "social.messaging", "social.profile"}}}
			s.cfg.MatrixAudienceActionVerifier = &syntheticAudienceActionVerifier{}
			confirmed, reads := false, 0
			authority.observe = func(MatrixAudienceMetadata) { confirmed = true }
			s.cfg.MatrixAudienceSessionRevalidator = syntheticAudienceRevalidator{run: func(_ context.Context, original productsessionv2.Session, scopes []string) (productsessionv2.Session, error) {
				reads++
				if !reflect.DeepEqual(scopes, []string{"social.contacts", "social.feed", "social.messaging", "social.profile"}) {
					t.Fatal("reader received widened or client-selected scopes")
				}
				if confirmed {
					return productsessionv2.Session{}, &productsessionv2.Error{Status: status, Code: "SYNTHETIC_REVALIDATION_REJECTION"}
				}
				return original, nil
			}}
			r := httptest.NewRequest(http.MethodPost, "/social/v3/matrix/audience/resolve", bytes.NewBufferString(`{"kind":"private"}`))
			r.Header.Set(productsessionv2.ProofHeader, base64.RawURLEncoding.EncodeToString([]byte(`{"platform":"native"}`)))
			r.Header.Set("X-YNX-Product-Session-Action-Proof-V2", "synthetic-action")
			w := httptest.NewRecorder()
			(&Server{service: s}).Handler().ServeHTTP(w, r)
			if w.Code != status || reads != 2 || len(s.state.MatrixAudiences) != 0 || len(s.state.MatrixAudienceNonces) != 1 {
				t.Fatal("after-await rejection lost classification or original intent", w.Code, reads)
			}
		})
	}
}

func TestMatrixAudienceConfidentialReaderCannotRelinkWidenOrRenew(t *testing.T) {
	mutations := map[string]func(*productsessionv2.Session){
		"actor":   func(session *productsessionv2.Session) { session.Account = "ynx1" + strings.Repeat("b", 38) },
		"binding": func(session *productsessionv2.Session) { session.SessionBinding = "replacement" },
		"scope":   func(session *productsessionv2.Session) { session.Scopes = append(session.Scopes, "social.ai") },
		"expiry": func(session *productsessionv2.Session) {
			session.ExpiresAt = time.Now().Add(24 * time.Hour).Format(time.RFC3339Nano)
		},
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			s, actor, _, authority := audienceFixture(t)
			s.cfg.ProductSessions = map[string]ProductSessionAuthorizer{"native": &audienceProofSpy{account: actor, approved: []string{"social.contacts", "social.feed", "social.messaging", "social.profile"}}}
			s.cfg.MatrixAudienceActionVerifier = &syntheticAudienceActionVerifier{}
			s.cfg.MatrixAudienceSessionRevalidator = syntheticAudienceRevalidator{run: func(_ context.Context, original productsessionv2.Session, _ []string) (productsessionv2.Session, error) {
				mutate(&original)
				return original, nil
			}}
			observations := 0
			authority.observe = func(MatrixAudienceMetadata) { observations++ }
			r := httptest.NewRequest(http.MethodPost, "/social/v3/matrix/audience/resolve", bytes.NewBufferString(`{"kind":"private"}`))
			r.Header.Set(productsessionv2.ProofHeader, base64.RawURLEncoding.EncodeToString([]byte(`{"platform":"native"}`)))
			r.Header.Set("X-YNX-Product-Session-Action-Proof-V2", "synthetic-action")
			w := httptest.NewRecorder()
			(&Server{service: s}).Handler().ServeHTTP(w, r)
			if w.Code != 403 || observations != 0 || len(s.state.MatrixAudienceNonces) != 0 {
				t.Fatal("reader silently changed original complete session", name, w.Code, observations)
			}
		})
	}
}

func (a *syntheticAudienceActionVerifier) VerifyHTTPAction(_ context.Context, _ *http.Request, session productsessionv2.Session, body []byte, scopes []string) (MatrixAudienceActionReceipt, error) {
	a.body = append([]byte(nil), body...)
	a.scopes = append([]string(nil), scopes...)
	expires, _ := time.Parse(time.RFC3339Nano, session.ExpiresAt)
	return MatrixAudienceActionReceipt{Nonce: "synthetic_action_nonce_001", BodyDigest: bridgeDigest(string(body)), SessionBinding: session.SessionBinding, ExpiresAt: expires}, nil
}

func (a *audienceProofSpy) Authorize(_ context.Context, r *http.Request, required []string) (productsessionv2.Session, error) {
	a.body, _ = io.ReadAll(r.Body)
	a.scopes = append([]string(nil), required...)
	return productsessionv2.Session{Platform: "native", SessionBinding: "synthetic-session-binding", ProductID: RequestingProduct, ClientID: ProductClientID, Account: a.account, ExpiresAt: time.Now().Add(time.Hour).Format(time.RFC3339Nano), Scopes: a.approved}, nil
}

func TestMatrixAudienceMountedRoutePreservesExactProofBodyAndRejectsOldGrant(t *testing.T) {
	s, actor, _, _ := audienceFixture(t)
	s.cfg.RateLimitMax = 20 // Isolate grant assertions from this fixture's tiny rate budget.
	required := []string{"social.contacts", "social.feed", "social.messaging", "social.profile"}
	spy := &audienceProofSpy{account: actor, approved: required}
	action := &syntheticAudienceActionVerifier{}
	s.cfg.MatrixAudienceActionVerifier = action
	s.cfg.ProductSessions = map[string]ProductSessionAuthorizer{"native": spy}
	handler := (&Server{service: s}).Handler()
	raw := []byte("{ \n  \"kind\" : \"private\"\n}")
	run := func() *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/social/v3/matrix/audience/resolve", bytes.NewReader(raw))
		request.Header.Set(productsessionv2.ProofHeader, base64.RawURLEncoding.EncodeToString([]byte(`{"platform":"native"}`)))
		request.Header.Set("X-YNX-Product-Session-Action-Proof-V2", "synthetic-verifier-only-not-a-real-proof")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	response := run()
	if response.Code != 200 {
		t.Fatalf("synthetic native authorizer contract failed %d %s", response.Code, response.Body.String())
	}
	if !bytes.Equal(spy.body, raw) || !reflect.DeepEqual(spy.scopes, required) {
		t.Fatal("serialized body or exact sorted scopes changed before authorizer")
	}
	if !bytes.Equal(action.body, raw) || !reflect.DeepEqual(action.scopes, required) {
		t.Fatal("action verifier did not receive exact business body/scopes")
	}
	if response = run(); response.Code != 409 {
		t.Fatal("action nonce replay was not denied", response.Code)
	}
	s.cfg.MatrixAudienceActionVerifier = nil
	if response = run(); response.Code != 503 {
		t.Fatal("introspection alone authorized business body", response.Code)
	}
	spy.approved = []string{"social.contacts", "social.messaging", "social.profile"}
	if response = run(); response.Code != 401 {
		t.Fatal("old chat grant implicitly acquired feed", response.Code)
	}
}

func TestMatrixAudienceCancelledConfirmationDoesNotPersistRoomBinding(t *testing.T) {
	s, actor, _, authority := audienceFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	authority.observe = func(MatrixAudienceMetadata) { cancel() }
	if _, err := s.ResolveMatrixAudience(ctx, actor, MatrixAudienceSelection{Kind: "private"}); err == nil {
		t.Fatal("cancelled policy operation succeeded")
	}
	if len(s.state.MatrixAudiences) != 0 {
		t.Fatal("cancelled operation persisted binding")
	}
}

func TestMatrixAudienceNonceReservationSurvivesRestartAndBlocksSecondObservation(t *testing.T) {
	s, actor, _, authority := audienceFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	observations := 0
	authority.observe = func(MatrixAudienceMetadata) { observations++; cancel() }
	receipt := &MatrixAudienceActionReceipt{Nonce: "synthetic_action_nonce_002", BodyDigest: "original-body-digest", SessionBinding: "synthetic-session", ExpiresAt: s.cfg.Now().Add(time.Minute)}
	selection := MatrixAudienceSelection{Kind: "contacts"}
	if _, err := s.resolveMatrixAudience(ctx, actor, selection, receipt); err == nil {
		t.Fatal("cancelled observed operation acknowledged")
	}
	if len(s.state.MatrixAudienceNonces) != 1 || len(s.state.MatrixAudiences) != 0 {
		t.Fatal("nonce and original pending intent were separated")
	}
	for _, record := range s.state.MatrixAudienceNonces {
		if record.Status != "prepared" || record.Selection == nil || record.Selection.Kind != "contacts" {
			t.Fatal("original intent not retained")
		}
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restarted.resolveMatrixAudience(context.Background(), actor, selection, receipt); err == nil {
		t.Fatal("same nonce reused after crash/restart")
	}
	if observations != 1 {
		t.Fatal("replayed nonce reached room observer", observations)
	}
}

func TestMatrixAudienceNonceClockRollbackAndStorageUncertaintyFailClosed(t *testing.T) {
	s, actor, _, _ := audienceFixture(t)
	selection := MatrixAudienceSelection{Kind: "private"}
	receipt := &MatrixAudienceActionReceipt{Nonce: "synthetic_action_nonce_003", BodyDigest: "original-body-digest", SessionBinding: "synthetic-session", ExpiresAt: s.cfg.Now().Add(time.Minute)}
	if _, err := s.resolveMatrixAudience(context.Background(), actor, selection, receipt); err != nil {
		t.Fatal(err)
	}
	previous := s.cfg.Now()
	s.cfg.Now = func() time.Time { return previous.Add(-time.Second) }
	receipt.Nonce = "synthetic_action_nonce_004"
	if _, err := s.resolveMatrixAudience(context.Background(), actor, selection, receipt); err == nil {
		t.Fatal("clock rollback admitted nonce")
	}
	s.stateWriteError = context.DeadlineExceeded
	if _, err := s.resolveMatrixAudience(context.Background(), actor, selection, receipt); err != context.DeadlineExceeded {
		t.Fatal("nonce operation bypassed storage latch", err)
	}
}

func TestMatrixAudienceDuplicateBusinessProofHeaderRejectedBeforeNonceOrRoom(t *testing.T) {
	s, actor, _, authority := audienceFixture(t)
	s.cfg.ProductSessions = map[string]ProductSessionAuthorizer{"native": &audienceProofSpy{account: actor, approved: []string{"social.contacts", "social.feed", "social.messaging", "social.profile"}}}
	s.cfg.MatrixAudienceActionVerifier = &syntheticAudienceActionVerifier{}
	observations := 0
	authority.observe = func(MatrixAudienceMetadata) { observations++ }
	r := httptest.NewRequest(http.MethodPost, "/social/v3/matrix/audience/resolve", bytes.NewBufferString(`{"kind":"private"}`))
	r.Header.Set(productsessionv2.ProofHeader, base64.RawURLEncoding.EncodeToString([]byte(`{"platform":"native"}`)))
	r.Header.Add("X-YNX-Product-Session-Action-Proof-V2", "first")
	r.Header.Add("X-YNX-Product-Session-Action-Proof-V2", "second")
	response := httptest.NewRecorder()
	(&Server{service: s}).Handler().ServeHTTP(response, r)
	if response.Code != 401 || observations != 0 || len(s.state.MatrixAudienceNonces) != 0 {
		t.Fatal("ambiguous business proof reached protected operation", response.Code, observations)
	}
}
