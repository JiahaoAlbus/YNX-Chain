package social

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
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
