package governance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"
)

func computePayloadHash(payload interface{}) string {
	payloadBytes, _ := json.Marshal(payload)
	h := sha256.Sum256(payloadBytes)
	return hex.EncodeToString(h[:])
}

func TestABCIHandlerProposalCreateAndVote(t *testing.T) {
	handler := NewABCIHandler(6423)
	now := time.Now().UTC()
	
	// Create a proposal
	payload := ProposalCreatePayload{
		Nonce:          "test-proposal-1",
		Scope:          "fee_burn_issuance",
		Summary:        "Adjust transaction fee to 0.001 YNXT",
		EconomicImpact: "Reduces user costs by 50%",
		SecurityRisk:   "Low - fee parameter change",
		Migration:      "Immediate upon execution",
		Rollback:       "Revert to previous fee parameter",
		Evidence:       []string{"https://forum.ynx.network/proposal-1"},
		Changes: []ParameterChangePayload{
			{Path: "chain.fees.transaction", Before: "0.002", After: "0.001"},
		},
	}
	
	payloadBytes, _ := json.Marshal(payload)
	payloadHash := computePayloadHash(payload)
	
	env := ActionEnvelope{
		Domain:       ActionDomain,
		ChainID:      6423,
		Action:       ActionProposalCreate,
		Signer:       "0x1234567890123456789012345678901234567890",
		AccountNonce: 0,
		Product:      "governance",
		DeviceID:     "device-1",
		SessionID:    "session-1",
		ExpiresAt:    now.Add(5 * time.Minute).Format(time.RFC3339),
		PayloadHash:  payloadHash,
		Payload:      payloadBytes,
		Signature:    "sig1", // Simplified
	}
	
	envBytes, _ := json.Marshal(env)
	
	// Check transaction
	if err := handler.CheckTx(envBytes, now); err != nil {
		t.Fatalf("CheckTx failed: %v", err)
	}
	
	// Deliver transaction
	receipt, err := handler.DeliverTx(envBytes, now, 1)
	if err != nil {
		t.Fatalf("DeliverTx failed: %v", err)
	}
	
	if receipt.Outcome != "verified" {
		t.Errorf("Expected outcome 'verified', got '%s'", receipt.Outcome)
	}
	
	if receipt.BlockHeight != 1 {
		t.Errorf("Expected height 1, got %d", receipt.BlockHeight)
	}
	
	// Verify proposal was created
	proposal, err := handler.state.GetProposal(receipt.TxHash)
	if err != nil {
		t.Fatalf("Failed to get proposal: %v", err)
	}
	
	if proposal.Proposer != env.Signer {
		t.Errorf("Expected proposer %s, got %s", env.Signer, proposal.Proposer)
	}
	
	if proposal.Status != "deposit" {
		t.Errorf("Expected status 'deposit', got '%s'", proposal.Status)
	}
}

func TestABCIHandlerReplayProtection(t *testing.T) {
	handler := NewABCIHandler(6423)
	now := time.Now().UTC()
	
	payload := ProposalCreatePayload{
		Nonce:   "replay-test",
		Scope:   "fee_burn_issuance",
		Summary: "Test proposal",
	}
	
	payloadBytes, _ := json.Marshal(payload)
	payloadHash := computePayloadHash(payload)
	
	env := ActionEnvelope{
		Domain:       ActionDomain,
		ChainID:      6423,
		Action:       ActionProposalCreate,
		Signer:       "0x1234567890123456789012345678901234567890",
		AccountNonce: 0,
		Product:      "governance",
		DeviceID:     "device-1",
		SessionID:    "session-1",
		ExpiresAt:    now.Add(5 * time.Minute).Format(time.RFC3339),
		PayloadHash:  payloadHash,
		Payload:      payloadBytes,
		Signature:    "sig1",
	}
	
	envBytes, _ := json.Marshal(env)
	
	// First delivery should succeed
	_, err := handler.DeliverTx(envBytes, now, 1)
	if err != nil {
		t.Fatalf("First DeliverTx failed: %v", err)
	}
	
	// Second delivery should fail with replay error
	err = handler.CheckTx(envBytes, now)
	if err != ErrReplayAttack {
		t.Errorf("Expected ErrReplayAttack, got %v", err)
	}
}

func TestABCIHandlerNonceValidation(t *testing.T) {
	handler := NewABCIHandler(6423)
	now := time.Now().UTC()
	
	payload := ProposalCreatePayload{
		Nonce:   "nonce-test",
		Scope:   "fee_burn_issuance",
		Summary: "Test proposal",
	}
	
	payloadBytes, _ := json.Marshal(payload)
	payloadHash := computePayloadHash(payload)
	
	// Try with wrong nonce (should be 0, using 5)
	env := ActionEnvelope{
		Domain:       ActionDomain,
		ChainID:      6423,
		Action:       ActionProposalCreate,
		Signer:       "0x1234567890123456789012345678901234567890",
		AccountNonce: 5,
		Product:      "governance",
		DeviceID:     "device-1",
		SessionID:    "session-1",
		ExpiresAt:    now.Add(5 * time.Minute).Format(time.RFC3339),
		PayloadHash:  payloadHash,
		Payload:      payloadBytes,
		Signature:    "sig1",
	}
	
	envBytes, _ := json.Marshal(env)
	
	err := handler.CheckTx(envBytes, now)
	if err != ErrNonceMismatch {
		t.Errorf("Expected ErrNonceMismatch, got %v", err)
	}
}

func TestABCIHandlerQueryProposal(t *testing.T) {
	handler := NewABCIHandler(6423)
	now := time.Now().UTC()
	
	// Create a proposal first
	payload := ProposalCreatePayload{
		Nonce:   "query-test",
		Scope:   "fee_burn_issuance",
		Summary: "Query test proposal",
	}
	
	payloadBytes, _ := json.Marshal(payload)
	payloadHash := computePayloadHash(payload)
	
	env := ActionEnvelope{
		Domain:       ActionDomain,
		ChainID:      6423,
		Action:       ActionProposalCreate,
		Signer:       "0x1234567890123456789012345678901234567890",
		AccountNonce: 0,
		Product:      "governance",
		DeviceID:     "device-1",
		SessionID:    "session-1",
		ExpiresAt:    now.Add(5 * time.Minute).Format(time.RFC3339),
		PayloadHash:  payloadHash,
		Payload:      payloadBytes,
		Signature:    "sig1",
	}
	
	envBytes, _ := json.Marshal(env)
	receipt, err := handler.DeliverTx(envBytes, now, 1)
	if err != nil {
		t.Fatalf("DeliverTx failed: %v", err)
	}
	
	// Query the proposal
	queryData, _ := json.Marshal(map[string]string{"id": receipt.TxHash})
	result, err := handler.Query("proposal", queryData)
	if err != nil {
		t.Fatalf("Query failed: %v", err)
	}
	
	var proposal ChainProposal
	if err := json.Unmarshal(result, &proposal); err != nil {
		t.Fatalf("Failed to unmarshal query result: %v", err)
	}
	
	if proposal.Summary != "Query test proposal" {
		t.Errorf("Expected summary 'Query test proposal', got '%s'", proposal.Summary)
	}
}
