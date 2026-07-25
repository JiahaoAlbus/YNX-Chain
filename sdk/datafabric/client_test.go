package datafabric

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type testCredentialProvider struct {
	t            *testing.T
	expectedPath string
}

func (p testCredentialProvider) Credentials(_ context.Context, binding RequestBinding) (CanonicalCredentials, error) {
	expectedPath := p.expectedPath
	if expectedPath == "" {
		expectedPath = "/v1/events"
	}
	if binding.Method == "" || binding.Path != expectedPath || len(binding.ContentSHA256) != 64 {
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

func TestClientReplayUsesApprovalControlPlaneAndValidatesCompletionTruth(t *testing.T) {
	previewHash := strings.Repeat("a", 64)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if dryRun, _ := body["dryRun"].(bool); dryRun {
			_ = json.NewEncoder(w).Encode(RedeliveryPreviewResult{
				Preview: RedeliveryPreview{
					Mode:      RedeliveryReplay,
					Scope:     RedeliveryScope{Product: "pay", AggregateID: "invoice.sdk.0001", Limit: 10},
					ScopeHash: previewHash, CandidateCount: 1,
					Candidates:  []RedeliveryCandidate{{EventID: "event.pay.sdk.replay.0001", EventType: "pay.invoice.created", SchemaVersion: EnvelopeSchemaVersion, AggregateID: "invoice.sdk.0001", Sequence: 1, OccurredAt: time.Now().UTC(), IntegrityHash: strings.Repeat("b", 64), DeliveryStatus: "published"}},
					GeneratedAt: time.Now().UTC(),
				},
				RequiresApproval: true, ExecutionEndpoint: "/v1/replay",
			})
			return
		}
		idempotencyKey, _ := body["idempotencyKey"].(string)
		_ = json.NewEncoder(w).Encode(RedeliveryExecutionResult{
			Run: RedeliveryRun{
				RunID: "redelivery.sdk.0001", IdempotencyKey: idempotencyKey, Mode: RedeliveryReplay,
				ApprovalStatus: "approved", ControlVersion: "1.0", SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c",
				SourceRelease: "data-fabric-testnet-v0", Status: "completed", CandidateCount: 1, EnqueuedCount: 1,
			},
			BusinessCompletion: "pending-consumer-effects", ExactlyOnceClaim: "idempotent-effect-not-broker-delivery",
		})
	}))
	defer server.Close()
	client, err := NewClient(server.URL, server.Client(), testCredentialProvider{t: t, expectedPath: "/v1/replay"})
	if err != nil {
		t.Fatal(err)
	}
	preview, err := client.PreviewReplay(context.Background(), RedeliveryPreviewRequest{AggregateID: "invoice.sdk.0001", Limit: 10})
	if err != nil || preview.Preview.ScopeHash != previewHash || !preview.RequiresApproval {
		t.Fatalf("SDK replay preview failed: %+v err=%v", preview, err)
	}
	result, err := client.ExecuteReplay(context.Background(), RedeliveryExecutionRequest{
		IdempotencyKey: "idempotency.sdk.replay.0001", AggregateID: "invoice.sdk.0001", Limit: 10,
		PreviewHash: preview.Preview.ScopeHash, Reason: "approved SDK replay after verified outage",
		ApprovalID: "approval.sdk.replay.0001", ApprovalStatus: "approved", Confirm: true, AuditID: "audit.sdk.replay.0001",
	})
	if err != nil || result.Run.EnqueuedCount != 1 || result.BusinessCompletion != "pending-consumer-effects" {
		t.Fatalf("SDK replay execution failed: %+v err=%v", result, err)
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
