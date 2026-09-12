package assetauth

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"
)

func TestSessionKeyBatchCallIsScopedBudgetedAndReplayProtected(t *testing.T) {
	account, _, sessionPrivate, _ := testSmartAccount(t)
	at := account.CreatedAt.Add(2 * time.Hour)
	operation := testUserOperation(account, at)
	operation.SessionKeyID = "session-1"
	signUserOperation(t, &operation, SignatureEd25519, sessionPrivate)
	next, err := account.AuthorizeUserOperation(operation, at)
	if err != nil {
		t.Fatal(err)
	}
	if next.NonceByDomain["product/pay"] != 1 || next.SessionKeys["session-1"].SpentYNXT != 5 {
		t.Fatalf("session operation did not consume nonce and budget: %+v", next)
	}
	if account.NonceByDomain["product/pay"] != 0 || account.SessionKeys["session-1"].SpentYNXT != 0 {
		t.Fatal("authorization mutated the input account")
	}
	if _, err := next.AuthorizeUserOperation(operation, at); err == nil {
		t.Fatal("replayed user operation accepted")
	}

	wrongScope := testUserOperation(account, at)
	wrongScope.SessionKeyID = "session-1"
	wrongScope.Calls[0].Method = "withdraw"
	signUserOperation(t, &wrongScope, SignatureEd25519, sessionPrivate)
	if _, err := account.AuthorizeUserOperation(wrongScope, at); err == nil {
		t.Fatal("session scope widening accepted")
	}

	overBudget := testUserOperation(account, at)
	overBudget.SessionKeyID = "session-1"
	overBudget.Calls[0].ValueYNXT = 11
	signUserOperation(t, &overBudget, SignatureEd25519, sessionPrivate)
	if _, err := account.AuthorizeUserOperation(overBudget, at); err == nil {
		t.Fatal("session spend limit bypass accepted")
	}
}

func TestInvalidSignatureDoesNotConsumeNonceOrSessionBudget(t *testing.T) {
	account, _, _, _ := testSmartAccount(t)
	at := account.CreatedAt.Add(2 * time.Hour)
	operation := testUserOperation(account, at)
	operation.SessionKeyID = "session-1"
	operation.Signature = make([]byte, ed25519.SignatureSize)
	if _, err := account.AuthorizeUserOperation(operation, at); err == nil {
		t.Fatal("invalid session signature accepted")
	}
	if account.NonceByDomain["product/pay"] != 0 || account.SessionKeys["session-1"].SpentYNXT != 0 {
		t.Fatal("failed authorization consumed nonce or budget")
	}
}

func TestPasskeyOwnerOperationAndEmergencySessionRevoke(t *testing.T) {
	account, _, _, _ := testSmartAccount(t)
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	account.OwnerAlgorithm = SignatureP256SHA256
	account.OwnerPublicKey = elliptic.MarshalCompressed(elliptic.P256(), privateKey.X, privateKey.Y)
	at := account.CreatedAt.Add(2 * time.Hour)
	operation := testUserOperation(account, at)
	digest, err := operation.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	operation.Signature, err = ecdsa.SignASN1(rand.Reader, privateKey, digest)
	if err != nil {
		t.Fatal(err)
	}
	next, err := account.AuthorizeUserOperation(operation, at)
	if err != nil || next.NonceByDomain["product/pay"] != 1 {
		t.Fatalf("passkey operation failed: %+v %v", next, err)
	}
	if _, err := account.RevokeSession(false, "session-1", at); err == nil {
		t.Fatal("non-owner session revocation accepted")
	}
	revoked, err := account.RevokeSession(true, "session-1", at)
	if err != nil || revoked.SessionKeys["session-1"].RevokedAt == nil {
		t.Fatalf("owner session revocation failed: %+v %v", revoked, err)
	}
}

func TestPaymasterEnforcesProductScopeAttestationAndBudgets(t *testing.T) {
	account, _, _, _ := testSmartAccount(t)
	at := account.CreatedAt.Add(2 * time.Hour)
	operation := testUserOperation(account, at)
	operation.PaymasterPolicy = "first-pay"
	policy := PaymasterPolicy{ID: "first-pay", Sponsor: "sponsor-1", Products: []string{"pay"}, Scopes: []string{"pay:settle"}, PerAccountBudget: 2, GlobalBudget: 3, AccountSpent: map[string]uint64{}, RequiresAttestation: true, ExpiresAt: at.Add(time.Hour)}
	attestation := sha256.Sum256([]byte("device-attestation"))
	next, err := policy.SponsorOperation(operation, 2, hex.EncodeToString(attestation[:]), at)
	if err != nil || next.GlobalSpent != 2 || next.AccountSpent[account.Address] != 2 {
		t.Fatalf("eligible sponsored operation failed: %+v %v", next, err)
	}
	if _, err := next.SponsorOperation(operation, 1, hex.EncodeToString(attestation[:]), at); err == nil {
		t.Fatal("per-account sponsor budget bypass accepted")
	}
	if _, err := policy.SponsorOperation(operation, 1, "", at); err == nil {
		t.Fatal("missing anti-sybil attestation accepted")
	}
	wrongScope := operation
	wrongScope.Calls = append([]AccountCall(nil), operation.Calls...)
	wrongScope.Calls[0].Method = "withdraw"
	if _, err := policy.SponsorOperation(wrongScope, 1, hex.EncodeToString(attestation[:]), at); err == nil {
		t.Fatal("paymaster scope widening accepted")
	}
}

func TestGuardianRecoveryRequiresThresholdDelayAndClearsSessions(t *testing.T) {
	account, _, _, guardianPrivate := testSmartAccount(t)
	created := account.CreatedAt.Add(3 * time.Hour)
	newPublic, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	proposal, err := NewRecoveryProposal(account, SignatureEd25519, newPublic, created)
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 2; index++ {
		id := []string{"guardian-a", "guardian-b"}[index]
		proposal, err = proposal.AddApproval(account.Recovery, GuardianApproval{GuardianID: id, Signature: ed25519.Sign(guardianPrivate[index], proposal.ApprovalMessage())})
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := account.ExecuteRecovery(proposal, proposal.ExecutableAt.Add(-time.Second)); err == nil {
		t.Fatal("guardian recovery bypassed timelock")
	}
	recovered, err := account.ExecuteRecovery(proposal, proposal.ExecutableAt)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.OwnerAlgorithm != SignatureEd25519 || string(recovered.OwnerPublicKey) != string(newPublic) || len(recovered.SessionKeys) != 0 || recovered.Recovery.Epoch != account.Recovery.Epoch+1 {
		t.Fatalf("guardian recovery did not rotate owner and revoke sessions: %+v", recovered)
	}
	if _, err := recovered.ExecuteRecovery(proposal, proposal.ExecutableAt); err == nil {
		t.Fatal("old recovery proposal replayed across policy epoch")
	}
}

func testSmartAccount(t *testing.T) (SmartAccount, ed25519.PrivateKey, ed25519.PrivateKey, []ed25519.PrivateKey) {
	t.Helper()
	ownerPublic, ownerPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	sessionPublic, sessionPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	guardians := map[string][]byte{}
	guardianPrivate := make([]ed25519.PrivateKey, 3)
	for index, id := range []string{"guardian-a", "guardian-b", "guardian-c"} {
		publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		guardians[id] = publicKey
		guardianPrivate[index] = privateKey
	}
	created := time.Unix(1_000, 0).UTC()
	account := SmartAccount{SchemaVersion: 1, ChainID: MandateChainID, Address: "ynx1account", OwnerAlgorithm: SignatureEd25519, OwnerPublicKey: ownerPublic, NonceByDomain: map[string]uint64{"product/pay": 0}, SessionKeys: map[string]SessionKey{"session-1": {ID: "session-1", Algorithm: SignatureEd25519, PublicKey: sessionPublic, Scopes: []string{"pay:settle"}, NonceDomain: "product/pay", SpendLimitYNXT: 10, ExpiresAt: created.Add(24 * time.Hour)}}, Recovery: GuardianRecoveryPolicy{Guardians: guardians, Threshold: 2, Delay: time.Hour, Epoch: 1}, CreatedAt: created}
	if err := account.Validate(); err != nil {
		t.Fatal(err)
	}
	return account, ownerPrivate, sessionPrivate, guardianPrivate
}

func testUserOperation(account SmartAccount, at time.Time) UserOperation {
	payload := sha256.Sum256([]byte("settle"))
	return UserOperation{Version: 1, ChainID: MandateChainID, Account: account.Address, ProductID: "pay", NonceDomain: "product/pay", Nonce: account.NonceByDomain["product/pay"], Calls: []AccountCall{{Target: "pay", Method: "settle", ValueYNXT: 5, Asset: "ynxt", PayloadHash: hex.EncodeToString(payload[:])}}, MaxFeeYNXT: 2, ValidAfter: at.Add(-time.Minute), ValidUntil: at.Add(time.Minute)}
}

func signUserOperation(t *testing.T, operation *UserOperation, algorithm string, privateKey ed25519.PrivateKey) {
	t.Helper()
	digest, err := operation.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	if algorithm != SignatureEd25519 {
		t.Fatal("test helper only supports Ed25519")
	}
	operation.Signature = ed25519.Sign(privateKey, digest)
}
