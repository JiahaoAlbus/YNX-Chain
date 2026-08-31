package datafabric

import (
	"context"
	"errors"
	"testing"
	"time"
)

type chainCommitmentVerifierFunc func(context.Context, ChainCommitmentReference) error

func (f chainCommitmentVerifierFunc) VerifyChainCommitment(ctx context.Context, reference ChainCommitmentReference) error {
	return f(ctx, reference)
}

func TestChainCommitmentReferenceIsV2ExactAndFailClosed(t *testing.T) {
	event := signedEvent(t, "event.pay.chain.0001", 1)
	if err := event.PromoteToV2(V2EnvelopeContext{
		Producer: "producer.pay.0001", AggregateType: "aggregate.invoice",
		TraceID: "trace.pay.chain.0001", RequestID: "request.pay.chain.0001", ResidencyClass: "account-home",
		ChainCommitmentID: "0123456789abcdef0123456789abcdef", IdempotencyKey: "idempotency.pay.chain.0001",
		ReceivedAt: event.Timestamp.Add(time.Second), Metadata: map[string]string{"contract": "chain-core-v1"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := event.Sign("key.datafabric.0001", testKey); err != nil {
		t.Fatal(err)
	}
	if err := VerifyChainCommitmentReference(context.Background(), nil, event); ErrorCodeOf(err) != CodeChainCommitmentUnavailable {
		t.Fatalf("missing Chain Core verifier did not fail closed: %v", err)
	}

	called := false
	verifier := chainCommitmentVerifierFunc(func(_ context.Context, reference ChainCommitmentReference) error {
		called = true
		if reference.ChainCommitmentID != event.ChainCommitmentID || reference.EventID != event.EventID || reference.EventIntegrityHash != event.Integrity.Digest {
			t.Fatalf("reference lost its signed event binding: %+v", reference)
		}
		return nil
	})
	if err := VerifyChainCommitmentReference(context.Background(), verifier, event); err != nil || !called {
		t.Fatalf("exact external reference was rejected: called=%t err=%v", called, err)
	}

	rejected := chainCommitmentVerifierFunc(func(context.Context, ChainCommitmentReference) error { return errors.New("not committed") })
	if err := VerifyChainCommitmentReference(context.Background(), rejected, event); ErrorCodeOf(err) != CodeChainCommitmentRejected {
		t.Fatalf("adapter rejection was not mapped to a stable code: %v", err)
	}
}

func TestChainCommitmentIdentifierRejectsWrongEnvelopeAndShape(t *testing.T) {
	event := signedEvent(t, "event.pay.chain.invalid.0001", 1)
	event.ChainCommitmentID = "0123456789abcdef0123456789abcdef"
	if err := event.Validate(); ErrorCodeOf(err) != CodeInvalidVersion {
		t.Fatalf("v1 chain reference was accepted: %v", err)
	}

	if err := event.PromoteToV2(V2EnvelopeContext{
		Producer: "producer.pay.0001", AggregateType: "aggregate.invoice",
		TraceID: "trace.pay.invalid.0001", RequestID: "request.pay.invalid.0001", ResidencyClass: "account-home",
		ChainCommitmentID: "commitment.not-chain-core.0001", IdempotencyKey: "idempotency.pay.invalid.0001",
		ReceivedAt: event.Timestamp.Add(time.Second), Metadata: map[string]string{"contract": "chain-core-v1"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := event.Validate(); ErrorCodeOf(err) != CodeChainCommitmentRejected {
		t.Fatalf("non-Chain-Core identifier was accepted: %v", err)
	}
}
