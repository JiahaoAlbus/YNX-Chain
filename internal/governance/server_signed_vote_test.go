package governance

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestServerRequiresSessionIdentityToMatchSignedVoterAndPersistsVote(t *testing.T) {
	now := time.Date(2026, 7, 25, 21, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtVoting(t, service, now, VotingSnapshot{BasePower: map[string]uint64{"alice": 100}})
	castAt := now.Add(4 * time.Minute)
	envelope := makeTestVoteEnvelope(t, service, proposal.ID, "alice", "yes", VoteOperationCast, 1, "signed-http-vote-nonce-0001", "", castAt)
	body, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "governance-state.json")
	if err = service.Save(statePath, now.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	auth := &testAuth{principal: Principal{Account: testVoterID("bob"), Product: "governance", DeviceID: "device-1", SessionID: "session-1", Roles: map[string]bool{"voter": true}, Scopes: map[Scope]bool{ScopeBridge: true}}}
	server, err := NewServer(service, auth, statePath, func() time.Time { return castAt })
	if err != nil {
		t.Fatal(err)
	}
	path := "/governance/proposals/" + proposal.ID + "/votes"
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("mismatched session voter status=%d body=%s", rec.Code, rec.Body.String())
	}
	if len(service.PublicVotes()) != 0 {
		t.Fatal("mismatched session mutated vote state")
	}

	auth.principal.Account = testVoterID("alice")
	req = httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("signed vote status=%d body=%s", rec.Code, rec.Body.String())
	}
	restored, err := Load(statePath)
	if err != nil {
		t.Fatal(err)
	}
	votes := restored.PublicVotes()
	if len(votes) != 1 || votes[0].Voter != testVoterID("alice") || votes[0].Signature == "" || !votes[0].CurrentRevision {
		t.Fatalf("signed HTTP vote not persisted: %+v", votes)
	}
}
