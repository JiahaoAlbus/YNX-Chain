package datafabric

import (
	"testing"
	"time"
)

func TestAllRequiredSagaKindsHaveCompensationAndRecovery(t *testing.T) {
	if len(SupportedSagaKinds()) != 13 {
		t.Fatalf("required saga catalog is incomplete: %d", len(SupportedSagaKinds()))
	}
	now := time.Date(2026, 7, 22, 13, 0, 0, 0, time.UTC)
	for _, kind := range SupportedSagaKinds() {
		saga, err := NewSaga("saga.required.0001", kind, "aggregate.required.0001", "correlation.required.0001", "audit.required.0001", now, now.Add(time.Minute))
		if err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		if len(saga.Steps) == 0 {
			t.Fatalf("%s has no steps", kind)
		}
		for _, step := range saga.Steps {
			if step.Action == "" || step.Compensation == "" {
				t.Fatalf("%s has an incomplete compensation contract", kind)
			}
		}
	}
}

func TestSagaCompletesAndCompensatesInReverseOrder(t *testing.T) {
	now := time.Date(2026, 7, 22, 13, 0, 0, 0, time.UTC)
	saga, err := NewSaga("saga.shop.0001", SagaShop, "order.shop.0001", "correlation.shop.0001", "audit.shop.0001", now, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if err := saga.CompleteStep("event.inventory.reserved.0001", now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := saga.CompleteStep("event.payment.captured.0001", now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := saga.Fail("fulfillment provider unavailable", now.Add(3*time.Second)); err != nil {
		t.Fatal(err)
	}
	if saga.Status != SagaCompensating || saga.UserVisibleStatus != "recovery-in-progress" {
		t.Fatalf("failure is not user visible: %+v", saga)
	}
	if err := saga.CompleteCompensation("event.payment.refunded.0001", now.Add(4*time.Second)); err != nil {
		t.Fatal(err)
	}
	if saga.Steps[1].CompensatedAt.IsZero() || !saga.Steps[0].CompensatedAt.IsZero() {
		t.Fatalf("compensation order is not reverse completion order")
	}
	if err := saga.CompleteCompensation("event.inventory.released.0001", now.Add(5*time.Second)); err != nil {
		t.Fatal(err)
	}
	if saga.Status != SagaCompensated || saga.UserVisibleStatus != "recovered" {
		t.Fatalf("saga did not reach recovered state: %+v", saga)
	}
}

func TestSagaTimeoutAndManualRecovery(t *testing.T) {
	now := time.Date(2026, 7, 22, 13, 0, 0, 0, time.UTC)
	saga, err := NewSaga("saga.dex.0001", SagaDEX, "vault.dex.0001", "correlation.dex.0001", "audit.dex.0001", now, now.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if err := saga.CompleteStep("event.vault.authorized.0001", now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	if saga.Status != SagaCompensating {
		t.Fatalf("deadline did not initiate compensation")
	}
	if err := saga.RequireManualRecovery("chain compensation needs wallet approval", now.Add(3*time.Second)); err != nil {
		t.Fatal(err)
	}
	if saga.Status != SagaManualRecovery || saga.UserVisibleStatus != "action-required" {
		t.Fatalf("manual recovery is not user visible")
	}
}

func TestSagaStorePersistsTimeout(t *testing.T) {
	path := t.TempDir() + "/store.json"
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 22, 13, 0, 0, 0, time.UTC)
	saga, err := NewSaga("saga.cloud.0001", SagaCloud, "usage.cloud.0001", "correlation.cloud.0001", "audit.cloud.0001", now, now.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.StartSaga(saga); err != nil {
		t.Fatal(err)
	}
	expired, err := store.ExpireSagas(now.Add(2 * time.Second))
	if err != nil || len(expired) != 1 {
		t.Fatalf("expire failed: %v %v", expired, err)
	}
	restarted, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	restored, exists := restarted.Saga(saga.SagaID)
	if !exists || restored.Status != SagaCompensated || restored.UserVisibleStatus != "recovered" {
		t.Fatalf("timeout state was not persisted: %+v", restored)
	}
}

func TestSagaRecoveryLeaseExecutesReverseCompensationIdempotently(t *testing.T) {
	path := t.TempDir() + "/store.json"
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 22, 13, 0, 0, 0, time.UTC)
	saga, err := NewSaga("saga.shop.recovery.0001", SagaShop, "order.shop.recovery.0001", "correlation.shop.recovery.0001", "audit.shop.recovery.0001", now, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.StartSaga(saga); err != nil {
		t.Fatal(err)
	}
	for sequence, eventID := range []string{
		"event.inventory.recovery.0001",
		"event.payment.recovery.0001",
		"event.refund.recovery.0001",
		"event.release.recovery.0001",
	} {
		appendSagaTestEvent(t, store, "shop", saga.AggregateID, saga.CorrelationID, eventID, uint64(sequence+1), now.Add(time.Duration(sequence)*time.Second))
	}
	if err := store.CompleteSagaStep(saga.SagaID, "event.inventory.recovery.0001", now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteSagaStep(saga.SagaID, "event.payment.recovery.0001", now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := store.FailSaga(saga.SagaID, "fulfillment unavailable", now.Add(3*time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteSagaCompensation(saga.SagaID, "event.refund.recovery.0001", now.Add(4*time.Second)); ErrorCodeOf(err) != CodeSagaRecoveryRouteRequired {
		t.Fatalf("Saga compensation bypassed recovery claim: %v", err)
	}
	tasks, err := store.ClaimSagaRecoveries("shop", "worker.shop.recovery.0001", now.Add(4*time.Second), time.Minute, 10)
	if err != nil || len(tasks) != 1 || tasks[0].StepIndex != 1 || tasks[0].Compensation != "refund-payment" || tasks[0].Attempt != 1 {
		t.Fatalf("first reverse compensation was not claimed: %+v err=%v", tasks, err)
	}
	if duplicate, err := store.ClaimSagaRecoveries("shop", "worker.shop.recovery.0002", now.Add(5*time.Second), time.Minute, 10); err != nil || len(duplicate) != 0 {
		t.Fatalf("active lease was claimed twice: %+v err=%v", duplicate, err)
	}
	if err := store.CompleteSagaRecovery(saga.SagaID, "saga-recovery.wrong", tasks[0].LeaseOwner, "event.refund.recovery.0001", now.Add(6*time.Second)); ErrorCodeOf(err) != CodeSagaRecoveryTaskMismatch {
		t.Fatalf("wrong recovery task was accepted: %v", err)
	}
	if err := store.CompleteSagaRecovery(saga.SagaID, tasks[0].TaskID, tasks[0].LeaseOwner, "event.refund.recovery.0001", now.Add(6*time.Second)); err != nil {
		t.Fatal(err)
	}
	tasks, err = store.ClaimSagaRecoveries("shop", "worker.shop.recovery.0001", now.Add(7*time.Second), time.Minute, 10)
	if err != nil || len(tasks) != 1 || tasks[0].StepIndex != 0 || tasks[0].Compensation != "release-inventory" {
		t.Fatalf("second reverse compensation was not claimed: %+v err=%v", tasks, err)
	}
	if err := store.CompleteSagaRecovery(saga.SagaID, tasks[0].TaskID, tasks[0].LeaseOwner, "event.release.recovery.0001", now.Add(8*time.Second)); err != nil {
		t.Fatal(err)
	}
	restarted, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	recovered, exists := restarted.Saga(saga.SagaID)
	if !exists || recovered.Status != SagaCompensated || recovered.RecoveryLease != nil || recovered.RecoveryAttempt != 2 {
		t.Fatalf("claimed recovery state was not persisted: %+v", recovered)
	}
}

func TestSagaRecoveryExpiredLeaseCanBeReclaimed(t *testing.T) {
	now := time.Date(2026, 7, 22, 13, 0, 0, 0, time.UTC)
	saga, err := NewSaga("saga.pay.reclaim.0001", SagaPay, "invoice.pay.reclaim.0001", "correlation.pay.reclaim.0001", "audit.pay.reclaim.0001", now, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if err := saga.CompleteStep("event.pay.authorized.reclaim.0001", now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := saga.Fail("settlement timeout", now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	first, claimed, err := saga.ClaimRecovery("worker.pay.reclaim.0001", now.Add(3*time.Second), now.Add(4*time.Second))
	if err != nil || !claimed {
		t.Fatalf("first recovery claim failed: %+v %v", first, err)
	}
	if err := saga.CompleteClaimedRecovery(first.TaskID, first.LeaseOwner, "event.pay.void.stale.0001", now.Add(5*time.Second)); ErrorCodeOf(err) != CodeSagaRecoveryLeaseExpired {
		t.Fatalf("expired lease completion was accepted: %v", err)
	}
	second, claimed, err := saga.ClaimRecovery("worker.pay.reclaim.0002", now.Add(5*time.Second), now.Add(6*time.Second))
	if err != nil || !claimed || second.TaskID != first.TaskID || second.Attempt != 2 {
		t.Fatalf("expired recovery was not safely reclaimed: %+v %v", second, err)
	}
}

func appendSagaTestEvent(t *testing.T, store *Store, product, aggregateID, correlationID, eventID string, sequence uint64, at time.Time) {
	t.Helper()
	event := EventEnvelope{
		EventID: eventID, EventType: product + ".saga.state_changed", SchemaVersion: EnvelopeSchemaVersion,
		Product: product, Service: "saga-test", AggregateID: aggregateID,
		Actor:         Actor{ActorID: "actor.saga.test.0001", AccountID: "account.saga.test.0001"},
		CorrelationID: correlationID, Sequence: sequence, Timestamp: at.UTC(), EffectiveAt: at.UTC(),
		SourceCommit: "719e101", SourceRelease: "data-fabric-test", PrivacyClassification: "confidential",
		RetentionClass: "financial-7y", AuditID: "audit." + eventID,
		Source:  SourceMetadata{Source: "saga-test", AsOf: at.UTC(), Version: "1", Status: "authoritative"},
		Payload: []byte(`{"status":"recorded"}`),
	}
	if err := event.Sign("key.saga.test.0001", testKey); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(event, testKey); err != nil {
		t.Fatal(err)
	}
}
