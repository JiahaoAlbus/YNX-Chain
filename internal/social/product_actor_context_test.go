package social

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMountedSettingsCancellationPreservesSessionAndAllowsNewRequest(t *testing.T) {
	f := newFixture(t, 89)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
	if err != nil {
		t.Fatal(err)
	}
	in := ProfileSettingsInput{IdempotencyKey: "cancelled-settings", AllowRequestsFrom: "nobody"}
	raw, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	request := bridgeRequest("android", "/social/v1/settings", http.MethodPut, nil)
	ctx, cancel := context.WithCancel(request.Context())
	defer cancel()
	request = request.WithContext(ctx)
	request.Body = io.NopCloser(&revokeDuringBodyRead{reader: bytes.NewReader(raw), revoke: func() {
		if a.calls != 1 {
			t.Fatal("cancellation must occur after the authority decision")
		}
		cancel()
	}})
	s.mu.Lock()
	before := objectDigest(s.state)
	s.mu.Unlock()
	response := httptest.NewRecorder()
	server := NewServer(s, s)
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusRequestTimeout {
		t.Fatalf("cancellation was misclassified: %d %s", response.Code, response.Body.String())
	}
	s.mu.Lock()
	after := objectDigest(s.state)
	s.mu.Unlock()
	if before != after {
		t.Fatal("cancelled request changed session or business state")
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, bridgeRequest("android", "/social/v1/settings", http.MethodPut, in))
	if response.Code != http.StatusOK {
		t.Fatalf("new request did not recover: %d %s", response.Code, response.Body.String())
	}
	if a.calls != 2 {
		t.Fatal("original proof decision was replayed within a request")
	}
	s.mu.Lock()
	stored := s.state.Sessions["psv2:"+bridgeDigest(a.session.SessionBinding)]
	_, receipt := s.state.Idempotency[idempotencyStateKey(actor.Account, in.IdempotencyKey)]
	s.mu.Unlock()
	if stored.RevokedAt != nil || stored.requestContext != nil || !receipt {
		t.Fatal("request context leaked into durable actor or recovery receipt missing")
	}
}

func TestRequestContextCannotChangeDurableSessionBytes(t *testing.T) {
	f := newFixture(t, 90)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
	if err != nil {
		t.Fatal(err)
	}
	original, err := json.Marshal(actor)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	actor.requestContext = ctx
	withContext, err := json.Marshal(actor)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(original, withContext) || strings.Contains(string(withContext), "requestContext") {
		t.Fatal("request-local context changed session wire/state schema")
	}
	cancel()
	request := bridgeRequest("android", "/social/v1/settings", http.MethodPut, nil).WithContext(ctx)
	server := NewServer(s, s)
	for _, platform := range []string{"android", "web"} {
		session := a.session
		session.Platform = platform
		if _, _, err := server.browserProductBinding(request, session, nil); !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled identity await for %s misclassified: %v", platform, err)
		}
	}
	if err := s.requireCurrentProductActor(actor, "social.profile"); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled actor committed: %v", err)
	}
	deadline, stop := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer stop()
	actor.requestContext = deadline
	if err := s.requireCurrentProductActor(actor, "social.profile"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("elapsed deadline committed: %v", err)
	}
	response := httptest.NewRecorder()
	writeServiceError(response, context.DeadlineExceeded)
	if response.Code != http.StatusRequestTimeout {
		t.Fatal("elapsed deadline treated as session revocation")
	}
}

func TestCancellationWhilePreparingContactEffectRollsBackOriginalTransaction(t *testing.T) {
	f, peer := newFixture(t, 91), newFixture(t, 92)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	a.session.Scopes = append(a.session.Scopes, "social.contacts")
	s := bridgeService(t, a, nil)
	actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	actor.requestContext = ctx
	now := s.cfg.Now()
	calls := 0
	s.cfg.Now = func() time.Time {
		calls++
		if calls == 2 {
			cancel()
		}
		return now
	}
	s.mu.Lock()
	before := objectDigest(s.state)
	s.mu.Unlock()
	_, _, err = s.RequestContact(actor, ContactRequestInput{IdempotencyKey: "cancel-at-persist", TargetAccount: peer.account, Source: "handle"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled prepared effect committed: %v", err)
	}
	s.mu.Lock()
	after := objectDigest(s.state)
	s.mu.Unlock()
	if before != after {
		t.Fatal("prepared request/notification/receipt/audit was not rolled back")
	}
}
