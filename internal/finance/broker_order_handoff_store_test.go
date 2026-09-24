package finance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFreshBrokerOrderHandoffDurableClaimAndOwnerIsolation(t *testing.T) {
	const account = "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	const other = "ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
	const publicKey = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	const callbackState = "state_0123456789abcdefghijklmnopqrst"
	const nonce = "claim_nonce_0123456789abcdefghijkl"
	const ticketHash = "abababababababababababababababababababababababababababababababab"
	now := time.Date(2026, 9, 25, 8, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "finance.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutBrokerSandboxMappingWithWalletKey(account, "01234567-89ab-4cde-8fab-0123456789ab", publicKey, now); err != nil {
		t.Fatal(err)
	}
	request := BrokerChallengeRequest{AccountPublicKey: publicKey, CallbackState: callbackState, FeeBoundEstablished: true, FeeEvidenceRef: "operator-policy:test",
		Order: FinanceOrderV1{AssetClass: "us_equity", AssetID: "11111111-2222-4333-8444-555555555555", Currency: "USD", FeeBoundSource: "operator_policy", LimitPrice: "10", MaxCost: "10", MaxFee: "0", OrderID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", OrderType: "limit", Qty: "1", Side: "buy", Symbol: "ACME", TimeInForce: "day"}}
	challenge, err := store.CreateBrokerOrderChallenge(account, request, now)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte(callbackState))
	if challenge.Unsigned.CallbackStateHash != hex.EncodeToString(digest[:]) {
		t.Fatal("fresh callback state was not SHA256-bound to the durable challenge")
	}
	if err := store.PutFreshBrokerOrderHandoff(account, challenge.Unsigned.RequestID, strings.Repeat("b", 64), challenge.Unsigned.CallbackStateHash, now); err == nil {
		t.Fatal("fresh ticket accepted the legacy raw callback hash as a state preimage")
	}
	if err := store.PutFreshBrokerOrderHandoff(account, challenge.Unsigned.RequestID, ticketHash, callbackState, now); err != nil {
		t.Fatal(err)
	}
	if err := store.PutFreshBrokerOrderHandoff(account, challenge.Unsigned.RequestID, strings.Repeat("c", 64), callbackState, now); err == nil {
		t.Fatal("one challenge accepted a second ticket")
	}
	profile, err := json.Marshal(store.Account(account))
	if err != nil || strings.Contains(string(profile), callbackState) || strings.Contains(string(profile), ticketHash) {
		t.Fatal("profile exposed confidential handoff state")
	}
	restarted, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.ClaimBrokerOrderHandoff(other, ticketHash, nonce, now.Add(time.Second)); err == nil {
		t.Fatal("another account claimed the ticket")
	}
	claimed, err := restarted.ClaimBrokerOrderHandoff(account, ticketHash, nonce, now.Add(time.Second))
	if err != nil || claimed.RequestID != challenge.Unsigned.RequestID {
		t.Fatalf("durable claim failed: %v", err)
	}
	if _, err := store.ClaimBrokerOrderHandoff(account, ticketHash, nonce, now.Add(2*time.Second)); err == nil {
		t.Fatal("claim nonce replay crossed independent store instances")
	}
	if _, err := restarted.ClaimBrokerOrderHandoff(account, ticketHash, "next_nonce_0123456789abcdefghijkl", now.Add(6*time.Minute)); err == nil {
		t.Fatal("expired ticket was claimed")
	}
	approvedProof := json.RawMessage(`{"version":"1","signature":"test-proof-for-store-cas-only"}`)
	approved, err := restarted.StoreBrokerOrderHandoffDecision(account, ticketHash, challenge.Unsigned.RequestID, "approved", approvedProof, strings.Repeat("d", 64), now.Add(3*time.Second))
	if err != nil || approved.DecisionStatus != "approved" {
		t.Fatalf("verified decision was not stored: %v", err)
	}
	if _, err := store.StoreBrokerOrderHandoffDecision(account, ticketHash, challenge.Unsigned.RequestID, "approved", approvedProof, strings.Repeat("e", 64), now.Add(4*time.Second)); err != nil {
		t.Fatalf("same proof could not retry with a fresh one-time code: %v", err)
	}
	if _, err := store.StoreBrokerOrderHandoffDecision(account, ticketHash, challenge.Unsigned.RequestID, "approved", json.RawMessage(`{"different":true}`), strings.Repeat("f", 64), now.Add(5*time.Second)); err == nil {
		t.Fatal("conflicting approval proof replaced the durable decision")
	}
	revokedProof := json.RawMessage(`{"version":"1","reason":"USER_REVOKED","signature":"test-revocation-cas-only"}`)
	if _, err := restarted.StoreBrokerOrderHandoffDecision(account, ticketHash, challenge.Unsigned.RequestID, "revoked", revokedProof, strings.Repeat("a", 64), now.Add(6*time.Second)); err != nil {
		t.Fatalf("unused approved decision could not be revoked: %v", err)
	}
	if _, err := restarted.StoreBrokerOrderHandoffDecision(account, ticketHash, challenge.Unsigned.RequestID, "rejected", revokedProof, strings.Repeat("b", 64), now.Add(7*time.Second)); err == nil {
		t.Fatal("revoked decision changed to rejected")
	}
	if err := store.updateAllState(account, "test.code_consumed", ticketHash, func(all *persistedState) error {
		record := all.BrokerOrderHandoffs[ticketHash]
		consumed := now.Add(8 * time.Second)
		record.CodeConsumedAt = &consumed
		all.BrokerOrderHandoffs[ticketHash] = record
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.StoreBrokerOrderHandoffDecision(account, ticketHash, challenge.Unsigned.RequestID, "revoked", revokedProof, strings.Repeat("c", 64), now.Add(9*time.Second)); err == nil {
		t.Fatal("a consumed decision accepted a second completion")
	}
	profile, err = json.Marshal(restarted.Account(account))
	if err != nil || strings.Contains(string(profile), string(approvedProof)) || strings.Contains(string(profile), string(revokedProof)) {
		t.Fatal("profile exposed a signed decision")
	}
}
