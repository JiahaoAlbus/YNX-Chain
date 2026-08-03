package governance

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func makeTestDelegation(t *testing.T, service *Service, delegatorLabel, delegateLabel string, scope Scope, amount uint64, operation string, revision uint64, supersedes string, override bool, now time.Time) SignedDelegationEnvelope {
	t.Helper()
	delegator := testVoter(delegatorLabel)
	envelope := SignedDelegationEnvelope{
		Version: SignedDelegationVersion, Domain: delegationDomain(service.policy), ChainID: service.policy.ChainID,
		Delegator: delegator.ID, Delegate: testVoterID(delegateLabel), Scope: scope, Amount: amount,
		Operation: operation, Revision: revision, Nonce: fmt.Sprintf("delegation-nonce-%s-%d-%d", delegatorLabel, revision, now.UnixNano()),
		PublicKey: delegator.PublicKey, StartsAt: now.UTC(), ExpiresAt: now.Add(30 * 24 * time.Hour).UTC(),
		DirectVoteOverride: override, SupersedesAuditHash: supersedes,
	}
	var err error
	envelope, err = SignDelegationEnvelope(envelope, delegator.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func TestSignedDelegationLifecycleRejectsReplayTamperAndUnsafeTopology(t *testing.T) {
	now := time.Date(2026, 7, 26, 8, 0, 0, 0, time.UTC)
	service := testService(t)
	register := makeTestDelegation(t, service, "alice", "bob", ScopeBridge, 40, DelegationOperationRegister, 1, "", true, now)
	first, err := service.ApplySignedDelegation(register, now)
	if err != nil || first.AuditHash == "" || first.Delegator != testVoterID("alice") {
		t.Fatalf("register: %+v %v", first, err)
	}
	if _, err = service.ApplySignedDelegation(register, now); !errors.Is(err, ErrReplay) {
		t.Fatalf("replay accepted: %v", err)
	}
	tampered := makeTestDelegation(t, service, "charlie", "dana", ScopeBridge, 10, DelegationOperationRegister, 1, "", false, now)
	tampered.Amount++
	if _, err = service.ApplySignedDelegation(tampered, now); !errors.Is(err, ErrForbidden) {
		t.Fatalf("tamper accepted: %v", err)
	}
	self := makeTestDelegation(t, service, "charlie", "charlie", ScopeBridge, 10, DelegationOperationRegister, 1, "", false, now)
	if _, err = service.ApplySignedDelegation(self, now); !errors.Is(err, ErrInvalid) {
		t.Fatalf("self-delegation accepted: %v", err)
	}
	multiHop := makeTestDelegation(t, service, "bob", "charlie", ScopeBridge, 10, DelegationOperationRegister, 1, "", false, now)
	if _, err = service.ApplySignedDelegation(multiHop, now); !errors.Is(err, ErrForbidden) {
		t.Fatalf("multi-hop accepted: %v", err)
	}
	redelegate := makeTestDelegation(t, service, "alice", "charlie", ScopeBridge, 30, DelegationOperationRedelegate, 2, first.AuditHash, true, now.Add(time.Minute))
	second, err := service.ApplySignedDelegation(redelegate, now.Add(time.Minute))
	if err != nil || second.Delegate != testVoterID("charlie") || second.Revision != 2 {
		t.Fatalf("redelegate: %+v %v", second, err)
	}
	service.mu.Lock()
	historical, historicalErr := service.bindPersistentDelegationsLocked(ScopeBridge, VotingSnapshot{BasePower: map[string]uint64{testVoterID("alice"): 40, testVoterID("bob"): 60, testVoterID("charlie"): 50}}, now.Add(30*time.Second))
	service.mu.Unlock()
	if historicalErr != nil || historical.Delegations[testVoterID("alice")] != testVoterID("bob") {
		t.Fatalf("historical delegation snapshot changed after redelegation: %+v %v", historical, historicalErr)
	}
	revoke := makeTestDelegation(t, service, "alice", "charlie", ScopeBridge, 30, DelegationOperationRevoke, 3, second.AuditHash, true, now.Add(2*time.Minute))
	revoke.StartsAt, revoke.ExpiresAt = second.StartsAt, second.ExpiresAt
	revoke, err = SignDelegationEnvelope(revoke, testVoter("alice").PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	third, err := service.ApplySignedDelegation(revoke, now.Add(2*time.Minute))
	if err != nil || third.Operation != DelegationOperationRevoke || len(service.PublicDelegations()) != 3 {
		t.Fatalf("revoke: %+v history=%v err=%v", third, service.PublicDelegations(), err)
	}
}

func TestPersistentDelegationBindsSnapshotAndDirectOverrideWithoutDoubleCount(t *testing.T) {
	now := time.Date(2026, 7, 26, 9, 0, 0, 0, time.UTC)
	service := testService(t)
	register := makeTestDelegation(t, service, "alice", "bob", ScopeBridge, 30, DelegationOperationRegister, 1, "", true, now)
	if _, err := service.ApplySignedDelegation(register, now); err != nil {
		t.Fatal(err)
	}
	proposal, err := service.Create(proposalInput(now), now)
	if err != nil {
		t.Fatal(err)
	}
	proposal, _ = service.Deposit(proposal.ID, 100, now.Add(time.Minute))
	proposal, _ = service.RecordSimulation(proposal.ID, Simulation{TechnicalEvidence: "technical simulation evidence", EconomicEvidence: "economic simulation evidence", SecurityEvidence: "security simulation evidence", UserImpactEvidence: "user-impact simulation evidence", Passed: true}, now.Add(2*time.Minute))
	proposal, err = openVoting(t, service, proposal.ID, VotingSnapshot{BasePower: map[string]uint64{"alice": 40, "bob": 60}}, now.Add(3*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	alice, bob := testVoterID("alice"), testVoterID("bob")
	if proposal.Delegations[alice] != bob || proposal.DelegatedPower[alice] != 30 || !proposal.DelegationOverrides[alice] || proposal.VotingPower[alice] != 10 || proposal.VotingPower[bob] != 90 {
		t.Fatalf("persistent delegation not bound: %+v", proposal)
	}
	if proposal, err = castTestVote(t, service, proposal.ID, "bob", "no", now.Add(4*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if proposal, err = castTestVote(t, service, proposal.ID, "alice", "yes", now.Add(5*time.Minute)); err != nil {
		t.Fatal(err)
	}
	participated, yes, no, veto := proposalTally(&proposal)
	if participated != 100 || yes != 40 || no != 60 || veto != 0 {
		t.Fatalf("override tally double-counted or misallocated: participated=%d yes=%d no=%d veto=%d", participated, yes, no, veto)
	}
	proposal, err = service.Finalize(proposal.ID, proposal.VotingEndsAt)
	if err != nil {
		t.Fatal(err)
	}
}

func TestDelegationPersistenceRejectsTamperedHistoryAndNonceRegistry(t *testing.T) {
	now := time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC)
	service := testService(t)
	register := makeTestDelegation(t, service, "alice", "bob", ScopeBridge, 40, DelegationOperationRegister, 1, "", false, now)
	if _, err := service.ApplySignedDelegation(register, now); err != nil {
		t.Fatal(err)
	}
	path := t.TempDir() + "/state.json"
	if err := service.Save(path, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	restored, err := Load(path)
	if err != nil || len(restored.PublicDelegations()) != 1 {
		t.Fatalf("restore: %v delegations=%v", err, restored.PublicDelegations())
	}
	rewriteSnapshot(t, path, func(envelope *snapshotEnvelope) {
		envelope.Payload.Delegations[0].Amount++
		envelope.Payload.Delegations[0].AuditHash = delegationAudit(envelope.Payload.Delegations[0])
	})
	if _, err = Load(path); !errors.Is(err, ErrForbidden) {
		t.Fatalf("signature-valid outer digest hid delegation tamper: %v", err)
	}
	if err = service.Save(path, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	rewriteSnapshot(t, path, func(envelope *snapshotEnvelope) {
		envelope.Payload.DelegationNonces = nil
	})
	if _, err = Load(path); !errors.Is(err, ErrForbidden) {
		t.Fatalf("missing delegation nonce registry accepted: %v", err)
	}
}

func TestDelegationHTTPMutationBindsProductSessionIdentityAndPersists(t *testing.T) {
	now := time.Date(2026, 7, 26, 11, 0, 0, 0, time.UTC)
	service := testService(t)
	path := filepath.Join(t.TempDir(), "state.json")
	auth := &testAuth{principal: Principal{Account: testVoterID("mallory"), Product: "governance", DeviceID: "device-1", SessionID: "session-1", Roles: map[string]bool{"delegator": true}, Scopes: map[Scope]bool{ScopeBridge: true}}}
	server, err := NewServer(service, auth, path, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	envelope := makeTestDelegation(t, service, "alice", "bob", ScopeBridge, 25, DelegationOperationRegister, 1, "", true, now)
	body, _ := json.Marshal(envelope)
	request := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/governance/delegations", bytes.NewReader(body))
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, req)
		return rec
	}
	if rec := request(); rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong session account accepted: status=%d body=%s", rec.Code, rec.Body.String())
	}
	auth.principal.Account = testVoterID("alice")
	if rec := request(); rec.Code != http.StatusCreated {
		t.Fatalf("valid delegation rejected: status=%d body=%s", rec.Code, rec.Body.String())
	}
	restored, err := Load(path)
	if err != nil || len(restored.PublicDelegations()) != 1 {
		t.Fatalf("HTTP mutation not persisted: %v records=%v", err, restored.PublicDelegations())
	}
}
