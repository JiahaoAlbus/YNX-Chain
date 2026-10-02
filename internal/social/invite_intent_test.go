package social

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestInvitationOriginalIntentCoalescesConcurrentRetriesAndReadback(t *testing.T) {
	f, other := newFixture(t, 96), newFixture(t, 97)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	actor := Session{Account: f.account}
	key := "invitation-" + strings.Repeat("a", 24)
	var wait sync.WaitGroup
	ids := make(chan string, 16)
	errs := make(chan error, 16)
	for i := 0; i < 16; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			record, _, err := s.CreateInviteIntent(actor, 24*time.Hour, key)
			ids <- record.ID
			errs <- err
		}()
	}
	wait.Wait()
	close(ids)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	expected := ""
	for id := range ids {
		if expected == "" {
			expected = id
		}
		if id != expected {
			t.Fatal("same original request created multiple invitations")
		}
	}
	if len(s.state.Invites) != 1 {
		t.Fatal("retry duplicated original capability")
	}
	result, err := s.ReadInvitations(actor, key)
	if err != nil || result.Operation == nil || !result.Operation.Confirmed || result.Operation.ID != expected || len(result.Invitations) != 1 {
		t.Fatal("original operation was not source-bound to actual invitation readback")
	}
	private, err := s.ReadInvitations(Session{Account: other.account}, key)
	if err != nil || len(private.Invitations) != 0 || private.Operation.Confirmed {
		t.Fatal("another account obtained an invitation or receipt")
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), f.account) || strings.Contains(string(raw), "tokenHash") {
		t.Fatal("normal invitation view exposed private account or token hash")
	}
	if _, _, err := s.CreateInviteIntent(actor, 48*time.Hour, key); err == nil {
		t.Fatal("original request changed expiry on retry")
	}
	if _, err := s.RevokeInvite(actor, expected); err != nil {
		t.Fatal(err)
	}
	again, _, err := s.CreateInviteIntent(actor, 24*time.Hour, key)
	if err != nil || again.ID != expected || again.RevokedAt == nil {
		t.Fatal("retry renewed a revoked invitation")
	}
	read, err := s.ReadInvitations(actor, key)
	if err != nil || read.Invitations[0].Status != "revoked" {
		t.Fatal("revocation was not read back")
	}
}

func TestInvitationHTTPUsesOriginalBoundDeviceAndPersistentReadback(t *testing.T) {
	f := newFixture(t, 99)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	a.session.Scopes = append(a.session.Scopes, "social.contacts")
	s := bridgeService(t, a, nil)
	handler := NewServer(s, s).Handler()
	call := func(path, method string, body any) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, bridgeRequest("android", path, method, body))
		return w
	}
	if bound := call("/social/v2/session/bind", "POST", bridgeRegistration(f, a.session)); bound.Code != 200 {
		t.Fatalf("original software device binding failed: %d", bound.Code)
	}
	key := "invitation-" + strings.Repeat("c", 24)
	body := map[string]any{"ttlSeconds": 86400, "idempotencyKey": key}
	created := call("/social/v1/invites", "POST", body)
	if created.Code != 201 {
		t.Fatalf("normal invitation failed: %d %s", created.Code, created.Body.String())
	}
	var original struct{ Record Invite }
	if json.Unmarshal(created.Body.Bytes(), &original) != nil {
		t.Fatal("invalid invitation response")
	}
	read := call("/social/v1/invites?intent="+key, "GET", nil)
	var snapshot InvitationSnapshot
	if read.Code != 200 || json.Unmarshal(read.Body.Bytes(), &snapshot) != nil || snapshot.Operation == nil || snapshot.Operation.ID != original.Record.ID || len(snapshot.Invitations) != 1 {
		t.Fatal("normal route did not confirm original invitation")
	}
	before, err := os.ReadFile(s.cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	handler = NewServer(restarted, restarted).Handler()
	retry := call("/social/v1/invites", "POST", body)
	var repeated struct{ Record Invite }
	if retry.Code != 201 || json.Unmarshal(retry.Body.Bytes(), &repeated) != nil || repeated.Record.ID != original.Record.ID || repeated.Record.Link != original.Record.Link || !repeated.Record.ExpiresAt.Equal(original.Record.ExpiresAt) {
		t.Fatalf("restart retry mismatch: status=%d body=%s original=%s repeated=%s expiry=%s/%s", retry.Code, retry.Body.String(), original.Record.ID, repeated.Record.ID, original.Record.ExpiresAt, repeated.Record.ExpiresAt)
	}
	after, err := os.ReadFile(s.cfg.StatePath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("confirmed retry changed original device/invitation state")
	}
	if revoked := call("/social/v1/invites/"+original.Record.ID+"/revoke", "POST", map[string]any{}); revoked.Code != 200 {
		t.Fatal("normal owner revocation failed")
	}
	read = call("/social/v1/invites?intent="+key, "GET", nil)
	if read.Code != 200 || json.Unmarshal(read.Body.Bytes(), &snapshot) != nil || snapshot.Invitations[0].Status != "revoked" {
		t.Fatal("normal revocation not confirmed by readback")
	}
	a.err = ErrUnauthorized
	if call("/social/v1/invites", "GET", nil).Code != 401 || call("/social/v1/invites", "POST", body).Code != 401 {
		t.Fatal("revoked private authority retained invitation access")
	}
}

func TestInvitationUnknownOriginalIntentNeverBecomesAFakeReceipt(t *testing.T) {
	f := newFixture(t, 98)
	s := bridgeService(t, &bridgeAuthority{session: bridgeSession(f, "android")}, nil)
	actor := Session{Account: f.account}
	key := "invitation-" + strings.Repeat("b", 24)
	before := len(s.state.Invites)
	result, err := s.ReadInvitations(actor, key)
	if err != nil || result.Operation == nil || result.Operation.Confirmed || len(s.state.Invites) != before {
		t.Fatal("unknown readback created an invitation or confirmation")
	}
	if _, _, err := s.CreateInviteIntent(actor, 24*time.Hour, "invalid key"); err == nil || len(s.state.Invites) != before {
		t.Fatal("invalid request identity produced an invitation")
	}
}
