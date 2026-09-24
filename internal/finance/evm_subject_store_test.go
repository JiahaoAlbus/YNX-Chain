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

func evmSubjectStoreFixture(t *testing.T, account, suffix string) (*Store, string, EVMSubjectChallengeRecord, EVMSubjectSessionRecord, time.Time) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "finance.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC)
	challenge := EVMSubjectChallengeRecord{
		RequestID: "finance.subject.request." + suffix, Nonce: "finance_subject_nonce_" + suffix,
		State: "finance_subject_state_" + suffix, Account: account, AccountType: "eoa",
		IssuedAt: now, ExpiresAt: now.Add(5 * time.Minute),
	}
	challengeJSON, _ := json.Marshal(map[string]any{
		"version": "1", "productId": "finance", "subjectNamespace": "evm", "origin": "https://finance.ynxweb4.com",
		"callback": "/wallet-auth/callback", "chainId": 6423, "scope": "finance.evm.private.read",
		"requestId": challenge.RequestID, "nonce": challenge.Nonce, "state": challenge.State,
		"account": account, "accountType": challenge.AccountType,
		"issuedAt": evmReadTime(challenge.IssuedAt), "expiresAt": evmReadTime(challenge.ExpiresAt),
	})
	challenge.ExactChallenge = string(challengeJSON)
	subjectID, err := DeriveFinanceEVMSubjectID(account)
	if err != nil {
		t.Fatal(err)
	}
	session := EVMSubjectSessionRecord{
		SessionID: "finance_subject_session_" + suffix, RequestID: challenge.RequestID, SubjectID: subjectID,
		Account: account, AccountType: "eoa", IssuedAt: now.Add(time.Minute), ExpiresAt: now.Add(5 * time.Minute),
	}
	sessionJSON, _ := json.Marshal(map[string]any{
		"version": "1", "productId": "finance", "subjectNamespace": "evm", "origin": "https://finance.ynxweb4.com",
		"chainId": 6423, "scope": "finance.evm.private.read", "nativeAccount": nil,
		"sessionId": session.SessionID, "subjectId": session.SubjectID, "account": account, "accountType": session.AccountType,
		"issuedAt": evmReadTime(session.IssuedAt), "expiresAt": evmReadTime(session.ExpiresAt),
	})
	session.ExactSession = string(sessionJSON)
	return store, path, challenge, session, now
}

func TestEVMSubjectSessionDurableCASAndTwoAccountIsolation(t *testing.T) {
	accountA := "0x" + strings.Repeat("a", 40)
	accountB := "0x" + strings.Repeat("b", 40)
	first, path, challengeA, sessionA, now := evmSubjectStoreFixture(t, accountA, strings.Repeat("a", 32))
	_, _, challengeB, sessionB, _ := evmSubjectStoreFixture(t, accountB, strings.Repeat("b", 32))
	for _, challenge := range []EVMSubjectChallengeRecord{challengeA, challengeB} {
		if err := first.PutEVMSubjectChallenge(challenge, now); err != nil {
			t.Fatal(err)
		}
		if err := first.ReserveEVMSubjectVerification(challenge.Account, challenge.RequestID, challenge.Nonce, now.Add(time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	second, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := second.CommitEVMSubjectSession(sessionA, challengeA.Nonce, challengeA.State, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := first.CommitEVMSubjectSession(sessionA, challengeA.Nonce, challengeA.State, now.Add(time.Minute)); err == nil {
		t.Fatal("challenge replay issued a second session")
	}
	if err := first.CommitEVMSubjectSession(sessionB, challengeB.Nonce, challengeB.State, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, session := range []EVMSubjectSessionRecord{sessionA, sessionB} {
		loaded, err := reopened.EVMSubjectSession(session.SessionID)
		if err != nil || loaded.SubjectID != session.SubjectID || loaded.ExactSession != session.ExactSession {
			t.Fatalf("EVM-only session not durable: %#v, %v", loaded, err)
		}
		subject := reopened.state.EVMSubjects[evmSubjectKey(session.Account)]
		if subject.NativeAccount != nil || subject.SubjectID != session.SubjectID {
			t.Fatalf("EVM-only identity became native or crossed accounts: %#v", subject)
		}
	}
	proofExpiry := now.Add(2 * time.Minute)
	proofNow := now.Add(time.Minute)
	if err := reopened.ConsumeEVMSubjectReadProof(accountB, sessionA.SubjectID, sessionA.SessionID, "cross_account_nonce_"+strings.Repeat("x", 32), proofExpiry, proofNow); err == nil {
		t.Fatal("account B used account A's EVM-only session")
	}
	if err := reopened.RevokeEVMSubjectSession(accountA, sessionB.SubjectID, sessionB.SessionID, "cross_revoke_nonce_"+strings.Repeat("x", 32), proofNow); err == nil {
		t.Fatal("account A revoked account B's session")
	}
	if err := reopened.RevokeEVMSubjectSession(accountA, sessionA.SubjectID, sessionA.SessionID, "valid_revoke_nonce_"+strings.Repeat("x", 32), proofNow); err != nil {
		t.Fatal(err)
	}
	if err := first.ConsumeEVMSubjectReadProof(accountA, sessionA.SubjectID, sessionA.SessionID, "late_read_nonce_"+strings.Repeat("x", 32), proofExpiry, proofNow); err == nil {
		t.Fatal("revoked account A session remained readable")
	}
	if err := first.ConsumeEVMSubjectReadProof(accountB, sessionB.SubjectID, sessionB.SessionID, "valid_read_nonce_"+strings.Repeat("x", 32), proofExpiry, proofNow); err != nil {
		t.Fatalf("account A revocation disrupted account B: %v", err)
	}
}

func TestEVMSubjectProofNonceConcurrentOneWinner(t *testing.T) {
	account := "0x" + strings.Repeat("c", 40)
	first, path, challenge, session, now := evmSubjectStoreFixture(t, account, strings.Repeat("c", 32))
	if err := first.PutEVMSubjectChallenge(challenge, now); err != nil {
		t.Fatal(err)
	}
	if err := first.ReserveEVMSubjectVerification(account, challenge.RequestID, challenge.Nonce, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := first.CommitEVMSubjectSession(session, challenge.Nonce, challenge.State, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	var winners atomic.Int32
	var group sync.WaitGroup
	for i := 0; i < 20; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			store, err := OpenStore(path)
			if err == nil && store.ConsumeEVMSubjectReadProof(account, session.SubjectID, session.SessionID, "shared_read_nonce_"+strings.Repeat("x", 32), now.Add(2*time.Minute), now.Add(time.Minute)) == nil {
				winners.Add(1)
			}
		}()
	}
	group.Wait()
	if winners.Load() != 1 {
		t.Fatalf("expected one replay nonce winner, got %d", winners.Load())
	}
}

func TestEVMSubjectPersistenceRejectsNativeLinkAndMalformedIdentity(t *testing.T) {
	account := "0x" + strings.Repeat("d", 40)
	store, _, challenge, session, now := evmSubjectStoreFixture(t, account, strings.Repeat("d", 32))
	wrongChallenge := challenge
	wrongChallenge.AccountType = "contract"
	if err := store.PutEVMSubjectChallenge(wrongChallenge, now); err == nil {
		t.Fatal("challenge exact JSON mismatch accepted")
	}
	if err := store.PutEVMSubjectChallenge(challenge, now); err != nil {
		t.Fatal(err)
	}
	if err := store.ReserveEVMSubjectVerification(account, challenge.RequestID, challenge.Nonce, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	badSession := session
	badSession.SubjectID = "evm_subject_" + strings.Repeat("0", 64)
	if err := store.CommitEVMSubjectSession(badSession, challenge.Nonce, challenge.State, now.Add(time.Minute)); err == nil {
		t.Fatal("forged subject ID accepted")
	}
	if err := store.CommitEVMSubjectSession(session, challenge.Nonce, challenge.State, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := store.ConsumeEVMSubjectReadProof(account, session.SubjectID, session.SessionID, "overlong_proof_nonce_"+strings.Repeat("x", 32), now.Add(6*time.Minute), now.Add(time.Minute)); err == nil {
		t.Fatal("proof extending session accepted")
	}
	subject := store.state.EVMSubjects[evmSubjectKey(account)]
	native := "YNX" + strings.Repeat("1", 40)
	subject.NativeAccount = &native
	if err := validateEVMSubjectRecord(evmSubjectKey(account), subject); err == nil {
		t.Fatal("EVM-only subject accepted a native account link")
	}
}
