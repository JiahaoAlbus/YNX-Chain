package datafabric

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestCardAndDurableLedgerCandidatesRemainUnactivatedAndRedacted(t *testing.T) {
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("candidate test source path unavailable")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(source), "..", "..", "schemas", "data-fabric"))
	ledger := readCandidateSchema(t, filepath.Join(root, "durable-ledger-v1.candidate.schema.json"))
	card := readCandidateSchema(t, filepath.Join(root, "card-ledger-events-v1.candidate.schema.json"))

	for name, document := range map[string]candidateSchema{"durable ledger": ledger, "card ledger": card} {
		if document.Status != "CANDIDATE" || document.Activation != "PROHIBITED_UNTIL_INTEGRATION_ACCEPTANCE" {
			t.Fatalf("%s candidate activation boundary changed: status=%q activation=%q", name, document.Status, document.Activation)
		}
	}
	for _, required := range []string{"journalId", "entries", "product", "timestamp", "source", "auditId"} {
		if !containsCandidateField(ledger.Required, required) {
			t.Fatalf("durable ledger candidate omitted required field %q", required)
		}
	}
	for _, required := range []string{"eventId", "eventType", "tenant", "cardReference", "chainId", "sequence", "effectiveAt", "payloadHash", "ledgerReference"} {
		if !containsCandidateField(card.Required, required) {
			t.Fatalf("card candidate omitted required field %q", required)
		}
	}
	for _, forbidden := range []string{"pan", "cvv", "trackData", "pin", "cryptogram", "magneticStripeData", "bearerToken", "privateKey"} {
		if _, exists := card.Properties[forbidden]; exists {
			t.Fatalf("card candidate exposes forbidden field %q", forbidden)
		}
	}
	var eventType struct {
		Enum []string `json:"enum"`
	}
	if err := json.Unmarshal(card.Properties["eventType"], &eventType); err != nil {
		t.Fatalf("decode card candidate event types: %v", err)
	}
	for _, requiredType := range []string{
		"card.created", "card.funded", "card.authorization.requested", "card.authorization.approved", "card.authorization.declined",
		"card.capture.completed", "card.authorization.reversed", "card.refund.created", "card.refund.completed", "card.balance.adjusted", "card.frozen", "card.unfrozen", "card.closed",
	} {
		if !containsCandidateField(eventType.Enum, requiredType) {
			t.Fatalf("card candidate omitted event type %q", requiredType)
		}
	}
	if _, exists := card.Properties["funding"]; !exists {
		t.Fatal("card candidate must require Testnet finality evidence for funding completion")
	}
}

type candidateSchema struct {
	Status     string                     `json:"x-contract-status"`
	Activation string                     `json:"x-activation"`
	Required   []string                   `json:"required"`
	Properties map[string]json.RawMessage `json:"properties"`
}

func readCandidateSchema(t *testing.T, path string) candidateSchema {
	t.Helper()
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read candidate schema %s: %v", path, err)
	}
	var document candidateSchema
	if err := json.Unmarshal(encoded, &document); err != nil {
		t.Fatalf("decode candidate schema %s: %v", path, err)
	}
	return document
}
