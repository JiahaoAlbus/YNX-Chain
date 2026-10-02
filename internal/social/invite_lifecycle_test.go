package social

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestInviteRevokeOwnerOnlyIdempotentAndPersistent(t *testing.T) {
	s, _ := testService(t)
	a, b := newFixture(t, 120), newFixture(t, 121)
	owner := Session{Account: a.account}
	record, token, err := s.CreateInvite(owner, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if account, err := s.ResolveDiscovery("invite", token); err != nil || account != a.account {
		t.Fatal("fresh invitation did not resolve")
	}
	if _, err := s.RevokeInvite(Session{Account: b.account}, record.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("another account revoked invitation")
	}
	if account, err := s.ResolveDiscovery("invite", token); err != nil || account != a.account {
		t.Fatal("unauthorized revoke changed invitation")
	}
	revoked, err := s.RevokeInvite(owner, record.ID)
	if err != nil || revoked.RevokedAt == nil || revoked.Link != record.Link {
		t.Fatal("owner revoke lost receipt")
	}
	auditCount := len(s.state.Audit)
	if retry, err := s.RevokeInvite(owner, record.ID); err != nil || retry.RevokedAt == nil || !retry.RevokedAt.Equal(*revoked.RevokedAt) || len(s.state.Audit) != auditCount {
		t.Fatal("repeated revoke changed receipt or audit")
	}
	if _, err := s.ResolveDiscovery("invite", token); !errors.Is(err, ErrNotFound) {
		t.Fatal("revoked invitation still resolves")
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.ResolveDiscovery("invite", token); !errors.Is(err, ErrNotFound) {
		t.Fatal("restart restored revoked invitation")
	}
	if _, err := restarted.RevokeInvite(owner, record.ID); err != nil {
		t.Fatal("restart lost owner revoke receipt")
	}
	if len(restarted.state.Requests) != 0 || len(restarted.state.Contacts) != 0 {
		t.Fatal("invitation operation created relationship")
	}
}

func TestInviteRevokeHTTPAndNoPlaceholderEndpoint(t *testing.T) {
	s, now := testService(t)
	s.cfg.RateLimitMax = 100
	a := newFixture(t, 122)
	login, err := s.Login(signedLogin(t, s, a, now))
	if err != nil {
		t.Fatal(err)
	}
	record, _, err := s.CreateInvite(Session{Account: a.account}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(s, nil).Handler())
	defer server.Close()
	for _, attempt := range []struct {
		token, body string
		status      int
	}{
		{"", "{}", http.StatusUnauthorized},
		{login.Token, `{"unknown":true}`, http.StatusBadRequest},
		{login.Token, "{}", http.StatusOK},
		{login.Token, "{}", http.StatusOK},
	} {
		response := doRequest(t, http.MethodPost, server.URL+"/social/v1/invites/"+record.ID+"/revoke", attempt.token, []byte(attempt.body))
		response.Body.Close()
		if response.StatusCode != attempt.status {
			t.Fatalf("revoke status=%d wanted=%d", response.StatusCode, attempt.status)
		}
	}
	response := doRequest(t, http.MethodGet, server.URL+"/social/v1/contact-requests-unused-compatibility-placeholder", login.Token, nil)
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("unexpected placeholder endpoint status=%d", response.StatusCode)
	}
}
