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
	if !exists || restored.Status != SagaCompensating || restored.UserVisibleStatus != "recovery-in-progress" {
		t.Fatalf("timeout state was not persisted: %+v", restored)
	}
}
