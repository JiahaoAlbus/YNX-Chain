package datafabric

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type testCredentialProvider struct {
	t         *testing.T
	eventBody []byte
}

func (p testCredentialProvider) Credentials(_ context.Context, binding RequestBinding) (CanonicalCredentials, error) {
	if binding.Method == "" || binding.Path != "/v1/events" || len(binding.ContentSHA256) != 64 {
		p.t.Fatalf("SDK supplied incomplete signing binding: %+v", binding)
	}
	return CanonicalCredentials{AppSession: "opaque-session", SessionID: "session.sdk.0001", DeviceID: "device.sdk.0001", Product: "pay", BundleID: "app.ynx.pay", RequestID: "request.sdk.0001", RequestNonce: "nonce.sdk.0001", RequestTime: time.Now().UTC(), DeviceSignature: "canonical-device-signature"}, nil
}

func TestClientBindsCanonicalCredentialsAndValidatesAppendAcknowledgement(t *testing.T) {
	event := sdkClientEvent(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, header := range []string{"X-YNX-App-Session", "X-YNX-Session-ID", "X-YNX-Device-ID", "X-YNX-Product", "X-YNX-Bundle-ID", "X-YNX-Request-ID", "X-YNX-Request-Nonce", "X-YNX-Timestamp", "X-YNX-Device-Signature", "X-YNX-Content-SHA256"} {
			if r.Header.Get(header) == "" {
				t.Errorf("missing canonical header %s", header)
			}
		}
		_ = json.NewEncoder(w).Encode(AppendResult{EventID: event.EventID, Status: "committed-to-outbox", AuditID: event.AuditID})
	}))
	defer server.Close()
	client, err := NewClient(server.URL, server.Client(), testCredentialProvider{t: t})
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.AppendEvent(context.Background(), event)
	if err != nil || result.EventID != event.EventID {
		t.Fatalf("append failed: %+v %v", result, err)
	}
}

func TestClientRejectsInsecureRemoteEndpoint(t *testing.T) {
	if _, err := NewClient("http://data-fabric.invalid", nil, testCredentialProvider{t: t}); err == nil {
		t.Fatal("insecure remote endpoint was accepted")
	}
}

func sdkClientEvent(t *testing.T) EventEnvelope {
	t.Helper()
	now := time.Date(2026, 7, 22, 16, 0, 0, 0, time.UTC)
	event := EventEnvelope{EventID: "event.pay.sdk.0001", EventType: "pay.invoice.created", SchemaVersion: EnvelopeSchemaVersion, Product: "pay", Service: "invoice", AggregateID: "invoice.sdk.0001", Actor: Actor{ActorID: "actor.sdk.0001", AccountID: "account.sdk.0001", SessionID: "session.sdk.0001"}, CorrelationID: "correlation.sdk.0001", Sequence: 1, Timestamp: now, EffectiveAt: now, SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "pay-testnet-v0", PrivacyClassification: "confidential", RetentionClass: "financial-7y", AuditID: "audit.sdk.0001", Source: SourceMetadata{Source: "sdk-test", AsOf: now, Version: "1", Status: "authoritative"}, Payload: json.RawMessage(`{"status":"created"}`)}
	if err := event.Sign("key.sdk.0001", []byte("0123456789abcdef0123456789abcdef")); err != nil {
		t.Fatal(err)
	}
	return event
}
