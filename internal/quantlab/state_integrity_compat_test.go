package quantlab

import (
	"encoding/json"
	"testing"
)

func TestVerifyStateBytesAcceptsExactHistoricalNestedShapeAndRejectsTamper(t *testing.T) {
	type persistedState struct {
		Schema           json.RawMessage `json:"schema"`
		Sequence         json.RawMessage `json:"sequence"`
		Experiments      json.RawMessage `json:"experiments"`
		Strategies       json.RawMessage `json:"strategies"`
		Datasets         json.RawMessage `json:"datasets"`
		Paper            json.RawMessage `json:"paper"`
		Mandates         json.RawMessage `json:"mandates"`
		TestnetOrders    json.RawMessage `json:"testnetOrders"`
		Idempotency      json.RawMessage `json:"idempotency"`
		ExecutionLedger  json.RawMessage `json:"executionLedger"`
		AdapterSequences json.RawMessage `json:"adapterSequences"`
		Audit            json.RawMessage `json:"audit"`
		Integrity        string          `json:"integrity"`
	}
	raw := persistedState{
		Schema: json.RawMessage(`1`), Sequence: json.RawMessage(`0`),
		Experiments: json.RawMessage(`{}`), Strategies: json.RawMessage(`{}`), Datasets: json.RawMessage(`{}`),
		Paper: json.RawMessage(`{"cash":100000000000,"legacyOnly":7}`), Mandates: json.RawMessage(`{}`),
		TestnetOrders: json.RawMessage(`{}`), Idempotency: json.RawMessage(`{}`), ExecutionLedger: json.RawMessage(`{}`),
		AdapterSequences: json.RawMessage(`{}`), Audit: json.RawMessage(`[]`),
	}
	raw.Integrity = hash(raw)
	encoded, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	var decoded state
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if verifyIntegrity(decoded) {
		t.Fatal("current typed checksum unexpectedly accepted a historical nested shape")
	}
	if !verifyStateBytes(encoded, decoded) {
		t.Fatal("exact historical persisted checksum was rejected")
	}
	tampered := append([]byte(nil), encoded...)
	for i := range tampered {
		if tampered[i] == '7' {
			tampered[i] = '8'
			break
		}
	}
	if json.Unmarshal(tampered, &decoded) != nil {
		t.Fatal("tamper fixture became invalid JSON")
	}
	if verifyStateBytes(tampered, decoded) {
		t.Fatal("tampered historical state was accepted")
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &top); err != nil {
		t.Fatal(err)
	}
	top["unknownTopLevel"] = json.RawMessage(`true`)
	withUnknown, _ := json.Marshal(top)
	if json.Unmarshal(withUnknown, &decoded) != nil {
		t.Fatal("unknown-field fixture became invalid JSON")
	}
	if verifyStateBytes(withUnknown, decoded) {
		t.Fatal("unknown top-level state field was accepted")
	}
}
