package exchangeproduct

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"testing"
)

func TestPostgresEnvelopePreservesAuthenticatedPayloadBytesAndRejectsTamper(t *testing.T) {
	s := newState()
	event := ExecutionEvent{Sequence: 1, Payload: json.RawMessage(`{"z":1,"a":9007199254740993}`)}
	event.Hash = digest(event)
	s.ExecutionEvents = []ExecutionEvent{event}
	s.EventSequence = 1
	s.IntegrityHash, _ = stateIntegrity(s)
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	// Legacy byte-intact records remain supported.
	if _, err := decodePostgresStateBytes(raw); err != nil {
		t.Fatal(err)
	}
	envelope := postgresStateEnvelope{Encoding: "base64-json-v1", SchemaVersion: s.SchemaVersion, IntegrityHash: s.IntegrityHash, StateBytes: base64.StdEncoding.EncodeToString(raw)}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	// Normalize the outer JSON as jsonb does; never decode numeric inner state.
	var normalized map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &normalized); err != nil {
		t.Fatal(err)
	}
	encoded, err = json.Marshal(normalized)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := decodePostgresStateBytes(encoded)
	if err != nil || !bytes.Equal(loaded.ExecutionEvents[0].Payload, event.Payload) {
		t.Fatalf("payload bytes lost: %v", err)
	}
	if err := verifyExecutionChain(&loaded); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*postgresStateEnvelope){
		func(e *postgresStateEnvelope) { e.Encoding = "unapproved" },
		func(e *postgresStateEnvelope) { e.StateBytes = "not-base64" },
		func(e *postgresStateEnvelope) { e.IntegrityHash = "wrong" },
		func(e *postgresStateEnvelope) { e.SchemaVersion++ },
		func(e *postgresStateEnvelope) {
			e.StateBytes = base64.StdEncoding.EncodeToString(bytes.Replace(raw, []byte("9007199254740993"), []byte("9007199254740994"), 1))
		},
	} {
		bad := envelope
		mutate(&bad)
		encoded, err := json.Marshal(bad)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := decodePostgresStateBytes(encoded); err == nil {
			t.Fatal("tampered envelope accepted")
		}
	}
}
