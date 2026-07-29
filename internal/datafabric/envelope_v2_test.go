package datafabric

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestEnvelopeV2PromotionSignVerifyAndRegistryValidation(t *testing.T) {
	event := signedEvent(t, "event.pay.v2.0001", 1)
	if err := event.PromoteToV2(V2EnvelopeContext{
		Producer: "producer.pay.0001", AggregateType: "aggregate.invoice",
		TraceID: "trace.pay.0001", RequestID: "request.pay.0001", ResidencyClass: "account-home",
		IdempotencyKey: "idempotency.pay.0001", ReceivedAt: event.Timestamp.Add(time.Second),
		Metadata: map[string]string{"contentType": "application/json"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := event.Sign("key.datafabric.0001", testKey); err != nil {
		t.Fatal(err)
	}
	if event.SchemaVersion != EnvelopeSchemaVersionV2 || event.Partition != "pay:invoice:aggregate.invoice:invoice.authority.0001" || event.IntegrityHash == "" || event.Signature == "" {
		t.Fatalf("v2 promotion is incomplete: %+v", event)
	}
	if err := event.Verify(testKey); err != nil {
		t.Fatal(err)
	}
	if err := DefaultSchemaRegistry().ValidateEnvelope(event); err != nil {
		t.Fatal(err)
	}
}

func TestEnvelopeV2RejectsPartitionSignatureAndFutureTimestamp(t *testing.T) {
	valid := signedEvent(t, "event.pay.v2.tamper.0001", 1)
	if err := valid.PromoteToV2(V2EnvelopeContext{
		Producer: "producer.pay.0001", AggregateType: "aggregate.invoice",
		TraceID: "trace.pay.0001", RequestID: "request.pay.0001", ResidencyClass: "global",
		IdempotencyKey: "idempotency.pay.0001", ReceivedAt: valid.Timestamp.Add(time.Second),
		Metadata: map[string]string{"contract": "v2"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := valid.Sign("key.datafabric.0001", testKey); err != nil {
		t.Fatal(err)
	}

	wrongPartition := valid
	wrongPartition.Partition = "pay:invoice:wrong:aggregate"
	if err := wrongPartition.Verify(testKey); ErrorCodeOf(err) != CodeWrongPartition {
		t.Fatalf("wrong partition was not rejected: %v", err)
	}

	wrongSignature := valid
	wrongSignature.Signature = strings.Repeat("0", 64)
	if err := wrongSignature.Verify(testKey); ErrorCodeOf(err) != CodeWrongSignature {
		t.Fatalf("wrong direct signature was not rejected: %v", err)
	}

	future := signedEvent(t, "event.pay.v2.future.0001", 1)
	future.Timestamp = time.Now().UTC().Add(10 * time.Minute)
	future.EffectiveAt = future.Timestamp
	future.Source.AsOf = future.Timestamp
	if err := future.PromoteToV2(V2EnvelopeContext{
		Producer: "producer.pay.0001", AggregateType: "aggregate.invoice",
		TraceID: "trace.pay.0001", RequestID: "request.pay.0001", ResidencyClass: "global",
		IdempotencyKey: "idempotency.pay.future.0001", ReceivedAt: future.Timestamp,
		Metadata: map[string]string{"contract": "v2"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := future.Sign("key.datafabric.0001", testKey); ErrorCodeOf(err) != CodeFutureTimestamp {
		t.Fatalf("future event was not rejected: %v", err)
	}
}

func TestStoreReturnsDistinctDuplicateGapAndOutOfOrderCodes(t *testing.T) {
	store, err := OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	first := signedEvent(t, "event.sequence.first.0001", 1)
	if err := store.Append(first, testKey); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(first, testKey); ErrorCodeOf(err) != CodeDuplicate || !errors.Is(err, ErrDuplicate) {
		t.Fatalf("duplicate code or sentinel is invalid: %v", err)
	}

	gap := signedEvent(t, "event.sequence.gap.0001", 3)
	if err := store.Append(gap, testKey); ErrorCodeOf(err) != CodeSequenceGap || !errors.Is(err, ErrOutOfOrder) || ErrorEvidenceOf(err)["expected"] != "2" {
		t.Fatalf("sequence gap code or evidence is invalid: %v", err)
	}

	late := signedEvent(t, "event.sequence.late.0001", 1)
	if err := store.Append(late, testKey); ErrorCodeOf(err) != CodeOutOfOrder || !errors.Is(err, ErrOutOfOrder) {
		t.Fatalf("out-of-order code or sentinel is invalid: %v", err)
	}
}

func TestEnvelopeV1ToV2CompatibilityIsTruthfullyIncompatible(t *testing.T) {
	report, err := DefaultSchemaRegistry().Compatibility("pay.invoice.created", EnvelopeSchemaVersion, EnvelopeSchemaVersionV2)
	if err != nil {
		t.Fatal(err)
	}
	if report.Compatible || !reportHasRule(report, "required envelope field") {
		t.Fatalf("v1 to v2 required-field migration was misreported: %+v", report)
	}
}
