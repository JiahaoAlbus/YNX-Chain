package finance

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func evmReadStoreFixture(t *testing.T) (*Store, string, EVMReadChallengeRecord, EVMReadSessionRecord, time.Time) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "finance.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 24, 15, 0, 0, 0, time.UTC)
	account := "0x" + strings.Repeat("a", 40)
	challenge := EVMReadChallengeRecord{
		RequestID: "finance_read_request_0123456789abcdef", Nonce: "finance_read_nonce_0123456789abcdef",
		State: "finance_read_state_0123456789abcdef", Account: account, IssuedAt: now, ExpiresAt: now.Add(5 * time.Minute),
	}
	challengeJSON, _ := json.Marshal(map[string]any{"requestId": challenge.RequestID, "nonce": challenge.Nonce, "state": challenge.State, "account": account, "issuedAt": evmReadTime(challenge.IssuedAt), "expiresAt": evmReadTime(challenge.ExpiresAt)})
	challenge.ExactChallenge = string(challengeJSON)
	session := EVMReadSessionRecord{
		SessionID: "finance_read_session_0123456789abcdef", RequestID: challenge.RequestID,
		Account: account, ChainID: 6423, Connected: true, IssuedAt: now.Add(time.Minute), ExpiresAt: now.Add(5 * time.Minute),
	}
	sessionJSON, _ := json.Marshal(map[string]any{"sessionId": session.SessionID, "requestId": session.RequestID, "account": account, "chainId": 6423, "issuedAt": evmReadTime(session.IssuedAt), "expiresAt": evmReadTime(session.ExpiresAt)})
	session.ExactSession = string(sessionJSON)
	return store, path, challenge, session, now
}

func TestEVMReadSessionAtomicallyConsumesChallengeAndPersistsAcrossStores(t *testing.T) {
	first, path, challenge, session, now := evmReadStoreFixture(t)
	if err := first.PutEVMReadChallenge(challenge, now); err != nil {
		t.Fatal(err)
	}
	second, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.ReserveEVMReadVerification(challenge.Account, challenge.RequestID, challenge.Nonce, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := second.CommitEVMReadSession(session, challenge.Nonce, challenge.State, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := first.CommitEVMReadSession(session, challenge.Nonce, challenge.State, now.Add(time.Minute)); err == nil {
		t.Fatal("replayed challenge issued another session")
	}
	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := reopened.EVMReadSession(session.SessionID)
	if err != nil || loaded.Account != challenge.Account || loaded.ExactSession != session.ExactSession {
		t.Fatalf("session not durable: %#v, %v", loaded, err)
	}
	proofNonce := "finance_proof_nonce_0123456789abcdef"
	if err := first.ConsumeEVMReadProof(challenge.Account, session.SessionID, proofNonce, now.Add(2*time.Minute), now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := reopened.ConsumeEVMReadProof(challenge.Account, session.SessionID, proofNonce, now.Add(2*time.Minute), now.Add(time.Minute)); err == nil {
		t.Fatal("cross-store proof replay accepted")
	}
	if err := reopened.ConsumeEVMReadProof("0x"+strings.Repeat("b", 40), session.SessionID, "other_proof_nonce_0123456789abcdef", now.Add(2*time.Minute), now.Add(time.Minute)); err == nil {
		t.Fatal("cross-account proof accepted")
	}
	if err := reopened.RevokeEVMReadSession(challenge.Account, session.SessionID, "revoke_proof_nonce_0123456789abcdef", now.Add(2*time.Minute), now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := second.ConsumeEVMReadProof(challenge.Account, session.SessionID, "later_proof_nonce_0123456789abcdef", now.Add(2*time.Minute), now.Add(time.Minute)); err == nil {
		t.Fatal("revoked session accepted a proof")
	}
	if err := second.RevokeEVMReadSession(challenge.Account, session.SessionID, "revoke_proof_nonce_0123456789abcdef", now.Add(2*time.Minute), now.Add(time.Minute)); err == nil {
		t.Fatal("replayed revoke accepted")
	}
}

func TestEVMReadSessionFailsClosedOnExpiryAndMetadataMismatch(t *testing.T) {
	store, _, challenge, session, now := evmReadStoreFixture(t)
	wrong := challenge
	wrong.Account = "0x" + strings.Repeat("b", 40)
	if err := store.PutEVMReadChallenge(wrong, now); err == nil {
		t.Fatal("challenge metadata mismatch accepted")
	}
	if err := store.PutEVMReadChallenge(challenge, now); err != nil {
		t.Fatal(err)
	}
	if err := store.ReserveEVMReadVerification(challenge.Account, challenge.RequestID, challenge.Nonce, now.Add(5*time.Minute)); err == nil {
		t.Fatal("expired challenge accepted")
	}
	if err := store.ReserveEVMReadVerification(challenge.Account, challenge.RequestID, challenge.Nonce, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	wrongSession := session
	wrongSession.Account = "0x" + strings.Repeat("b", 40)
	if err := store.CommitEVMReadSession(wrongSession, challenge.Nonce, challenge.State, now.Add(time.Minute)); err == nil {
		t.Fatal("session metadata mismatch accepted")
	}
	if err := store.CommitEVMReadSession(session, challenge.Nonce, challenge.State, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := store.ConsumeEVMReadProof(challenge.Account, session.SessionID, "expired_proof_nonce_0123456789abcdef", now.Add(6*time.Minute), now.Add(time.Minute)); err == nil {
		t.Fatal("proof exceeding session expiry accepted")
	}
	if err := store.ConsumeEVMReadProof(challenge.Account, session.SessionID, "fresh_proof_nonce_0123456789abcdef", now.Add(5*time.Minute), now.Add(5*time.Minute)); err == nil {
		t.Fatal("expired session accepted")
	}
}

func TestEVMReadSessionConcurrentCrossStoreProofNonceHasOneWinner(t *testing.T) {
	first, path, challenge, session, now := evmReadStoreFixture(t)
	if err := first.PutEVMReadChallenge(challenge, now); err != nil {
		t.Fatal(err)
	}
	if err := first.ReserveEVMReadVerification(challenge.Account, challenge.RequestID, challenge.Nonce, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := first.CommitEVMReadSession(session, challenge.Nonce, challenge.State, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	var winners atomic.Int32
	var group sync.WaitGroup
	for i := 0; i < 20; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			store, err := OpenStore(path)
			if err == nil && store.ConsumeEVMReadProof(challenge.Account, session.SessionID, "shared_proof_nonce_0123456789abcdef", now.Add(2*time.Minute), now.Add(time.Minute)) == nil {
				winners.Add(1)
			}
		}()
	}
	group.Wait()
	if winners.Load() != 1 {
		t.Fatalf("expected one atomic proof nonce winner, got %d", winners.Load())
	}
}

func TestEVMReadSessionTwoAccountsRemainIsolatedAcrossRevoke(t *testing.T) {
	first, path, challengeA, sessionA, now := evmReadStoreFixture(t)
	challengeB := challengeA
	challengeB.Account = "0x" + strings.Repeat("b", 40)
	challengeB.RequestID = "finance_read_request_bbbbbbbbbbbbbbbb"
	challengeB.Nonce = "finance_read_nonce_bbbbbbbbbbbbbbbb"
	challengeB.State = "finance_read_state_bbbbbbbbbbbbbbbb"
	challengeJSON, _ := json.Marshal(map[string]any{"requestId": challengeB.RequestID, "nonce": challengeB.Nonce, "state": challengeB.State, "account": challengeB.Account, "issuedAt": evmReadTime(challengeB.IssuedAt), "expiresAt": evmReadTime(challengeB.ExpiresAt)})
	challengeB.ExactChallenge = string(challengeJSON)
	sessionB := sessionA
	sessionB.Account = challengeB.Account
	sessionB.RequestID = challengeB.RequestID
	sessionB.SessionID = "finance_read_session_bbbbbbbbbbbbbbbb"
	sessionJSON, _ := json.Marshal(map[string]any{"sessionId": sessionB.SessionID, "requestId": sessionB.RequestID, "account": sessionB.Account, "chainId": 6423, "issuedAt": evmReadTime(sessionB.IssuedAt), "expiresAt": evmReadTime(sessionB.ExpiresAt)})
	sessionB.ExactSession = string(sessionJSON)
	for _, challenge := range []EVMReadChallengeRecord{challengeA, challengeB} {
		if err := first.PutEVMReadChallenge(challenge, now); err != nil {
			t.Fatal(err)
		}
		if err := first.ReserveEVMReadVerification(challenge.Account, challenge.RequestID, challenge.Nonce, now.Add(time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	for _, selected := range []struct {
		challenge EVMReadChallengeRecord
		session   EVMReadSessionRecord
	}{{challengeA, sessionA}, {challengeB, sessionB}} {
		if err := first.CommitEVMReadSession(selected.session, selected.challenge.Nonce, selected.challenge.State, now.Add(time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	second, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	proofExpiry := now.Add(2 * time.Minute)
	proofNow := now.Add(time.Minute)
	if err := second.ConsumeEVMReadProof(challengeB.Account, sessionA.SessionID, "cross_account_proof_0123456789abcdef", proofExpiry, proofNow); err == nil {
		t.Fatal("account B consumed account A's session")
	}
	if err := second.RevokeEVMReadSession(challengeA.Account, sessionB.SessionID, "cross_account_revoke_0123456789abcdef", proofExpiry, proofNow); err == nil {
		t.Fatal("account A revoked account B's session")
	}
	if err := second.RevokeEVMReadSession(challengeA.Account, sessionA.SessionID, "account_a_revoke_0123456789abcdef", proofExpiry, proofNow); err != nil {
		t.Fatal(err)
	}
	if err := first.ConsumeEVMReadProof(challengeA.Account, sessionA.SessionID, "account_a_late_proof_0123456789abcdef", proofExpiry, proofNow); err == nil {
		t.Fatal("revoked account A session remained readable")
	}
	if err := first.ConsumeEVMReadProof(challengeB.Account, sessionB.SessionID, "account_b_valid_proof_0123456789abcdef", proofExpiry, proofNow); err != nil {
		t.Fatalf("account A revocation disrupted account B: %v", err)
	}
}
