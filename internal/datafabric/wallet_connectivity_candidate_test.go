package datafabric

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestWalletConnectivityCandidateRemainsUnactivatedAndPrivacyBounded(t *testing.T) {
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("candidate test source path unavailable")
	}
	path := filepath.Clean(filepath.Join(filepath.Dir(source), "..", "..", "schemas", "data-fabric", "wallet-connectivity-events-v1.candidate.schema.json"))
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read candidate schema: %v", err)
	}
	var document struct {
		Status     string                     `json:"x-contract-status"`
		Activation string                     `json:"x-activation"`
		Required   []string                   `json:"required"`
		Properties map[string]json.RawMessage `json:"properties"`
	}
	if err := json.Unmarshal(encoded, &document); err != nil {
		t.Fatalf("decode candidate schema: %v", err)
	}
	if document.Status != "CANDIDATE" || document.Activation != "PROHIBITED_UNTIL_INTEGRATION_ACCEPTANCE" {
		t.Fatalf("candidate activation boundary changed: status=%q activation=%q", document.Status, document.Activation)
	}
	for _, required := range []string{"eventId", "eventType", "tenant", "connectionId", "correlationId", "causationId", "sequence", "effectiveAt", "sourceCommit", "releaseId", "privacyClass", "retention", "auditId", "payloadHash", "status"} {
		if !containsCandidateField(document.Required, required) {
			t.Fatalf("candidate omitted required field %q", required)
		}
	}
	for _, forbidden := range []string{"seed", "privateKey", "deviceSecret", "bearerToken", "walletConnectSymmetricKey", "signature", "privateMessage", "siwePrivateContent", "accountId", "walletAddress", "pan", "cvv"} {
		if _, exists := document.Properties[forbidden]; exists {
			t.Fatalf("candidate exposes forbidden field %q", forbidden)
		}
	}
	var eventType struct {
		Enum []string `json:"enum"`
	}
	if err := json.Unmarshal(document.Properties["eventType"], &eventType); err != nil {
		t.Fatalf("decode candidate event types: %v", err)
	}
	for _, requiredType := range []string{
		"wallet.connection.requested", "wallet.connection.approved", "wallet.connection.rejected", "wallet.connection.established",
		"wallet.connection.disconnected", "wallet.connection.recovered", "wallet.connection.expired", "wallet.connection.revoked",
		"product.session.upgrade.requested", "product.session.upgrade.completed", "product.session.upgrade.failed", "product.session.revoked",
		"walletconnect.pairing.created", "walletconnect.session.established", "walletconnect.session.disconnected",
		"endpoint.health.degraded", "endpoint.health.recovered", "endpoint.schema.mismatch",
		"faucet.requested", "faucet.completed", "faucet.failed", "client.retired", "client.retired.connection_rejected",
	} {
		if !containsCandidateField(eventType.Enum, requiredType) {
			t.Fatalf("candidate omitted event type %q", requiredType)
		}
	}
	if _, exists := document.Properties["faucet"]; !exists {
		t.Fatal("candidate must model finalized faucet completion evidence")
	}
}

func containsCandidateField(fields []string, want string) bool {
	for _, field := range fields {
		if field == want {
			return true
		}
	}
	return false
}
