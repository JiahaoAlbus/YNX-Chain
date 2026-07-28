package payproduct

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestBulkWebhookRetryPreviewIsTenantScoped(t *testing.T) {
	now := time.Date(2026, 7, 27, 17, 0, 0, 0, time.UTC)
	current := now
	service, _ := testService(t, &fakePay{}, func() time.Time { return current })
	merchant, _ := onboard(t, service)
	principal := MerchantPrincipal{Merchant: merchant, Account: merchant.PayoutAddress, Role: "owner"}
	if err := service.store.Update(func(data *Snapshot) error {
		for i, id := range []string{"whd_bulk_a", "whd_bulk_b", "whd_bulk_c"} {
			data.Deliveries[id] = WebhookDelivery{ID: id, MerchantID: merchant.ID, EventType: "invoice.committed", ObjectID: "inv_bulk", Attempt: i + 1, Status: "failed", HTTPStatus: 503, CreatedAt: now.Add(-time.Duration(i+1) * time.Minute), UpdatedAt: now.Add(-time.Duration(i+1) * time.Minute)}
		}
		data.Deliveries["whd_bulk_foreign"] = WebhookDelivery{ID: "whd_bulk_foreign", MerchantID: "mrc_foreign_bulk", Status: "failed", CreatedAt: now, UpdatedAt: now}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	preview, err := service.PreviewBulkWebhookRetry(principal, []string{"whd_bulk_b", "whd_bulk_a"})
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Items) != 2 || preview.Items[0].ID != "whd_bulk_a" || preview.StateDigest == "" || preview.ConfirmationToken == "" {
		t.Fatalf("unexpected preview: %+v", preview)
	}
	foreign := MerchantPrincipal{Merchant: Merchant{ID: "mrc_foreign_bulk"}, Account: "actor-foreign", Role: "owner"}
	if _, err := service.PreviewBulkWebhookRetry(foreign, []string{"whd_bulk_a"}); err == nil {
		t.Fatal("foreign merchant previewed another tenant delivery")
	}
	staleInput := bulkRetryInputFromPreview(t, preview, []string{"whd_bulk_b", "whd_bulk_a"}, strings.Repeat("s", 12))
	otherActor := MerchantPrincipal{Merchant: merchant, Account: "actor-other", Role: "owner"}
	if _, err := service.BulkRetryWebhooks(context.Background(), otherActor, staleInput); err == nil {
		t.Fatal("bulk retry confirmation was transferable to another actor")
	}
	if err := service.store.Update(func(data *Snapshot) error {
		delivery := data.Deliveries["whd_bulk_a"]
		delivery.Attempt++
		delivery.UpdatedAt = now.Add(time.Second)
		data.Deliveries[delivery.ID] = delivery
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.BulkRetryWebhooks(context.Background(), principal, staleInput); err == nil {
		t.Fatal("stale bulk retry confirmation was accepted after delivery state changed")
	}
	preview, err = service.PreviewBulkWebhookRetry(principal, []string{"whd_bulk_a", "whd_bulk_b"})
	if err != nil {
		t.Fatal(err)
	}

	operationValue := strings.Repeat("o", 12)
	input := bulkRetryInputFromPreview(t, preview, []string{"whd_bulk_b", "whd_bulk_a"}, operationValue)
	result, err := service.BulkRetryWebhooks(context.Background(), principal, input)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" || result.Attempted != 2 || result.Retrying != 2 || result.Replayed {
		t.Fatalf("bulk retry execution was not complete: %+v", result)
	}
	attempts := map[string]int{}
	if err := service.store.View(func(data Snapshot) error {
		attempts["whd_bulk_a"] = data.Deliveries["whd_bulk_a"].Attempt
		attempts["whd_bulk_b"] = data.Deliveries["whd_bulk_b"].Attempt
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	replay, err := service.BulkRetryWebhooks(context.Background(), principal, input)
	if err != nil {
		t.Fatal(err)
	}
	if !replay.Replayed || replay.OperationID != result.OperationID {
		t.Fatalf("bulk retry replay was not identified: %+v", replay)
	}
	if err := service.store.View(func(data Snapshot) error {
		if data.Deliveries["whd_bulk_a"].Attempt != attempts["whd_bulk_a"] || data.Deliveries["whd_bulk_b"].Attempt != attempts["whd_bulk_b"] {
			t.Fatal("idempotent replay repeated webhook delivery attempts")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	thirdPreview, err := service.PreviewBulkWebhookRetry(principal, []string{"whd_bulk_c"})
	if err != nil {
		t.Fatal(err)
	}
	conflictInput := bulkRetryInputFromPreview(t, thirdPreview, []string{"whd_bulk_c"}, operationValue)
	if _, err := service.BulkRetryWebhooks(context.Background(), principal, conflictInput); err == nil {
		t.Fatal("idempotency value conflict with different deliveries was accepted")
	}
	current = now.Add(bulkWebhookRetryConfirmationTTL + time.Second)
	expiredInput := bulkRetryInputFromPreview(t, thirdPreview, []string{"whd_bulk_c"}, strings.Repeat("e", 12))
	if _, err := service.BulkRetryWebhooks(context.Background(), principal, expiredInput); err == nil {
		t.Fatal("expired bulk retry confirmation was accepted")
	}

	state, err := service.SnapshotForMerchant(merchant.ID)
	if err != nil {
		t.Fatal(err)
	}
	started, finished := false, false
	for _, entry := range state.Audit {
		if entry.ObjectID != result.OperationID {
			continue
		}
		started = started || entry.Action == "webhook.bulk-retry.start" && entry.Outcome == "accepted"
		finished = finished || entry.Action == "webhook.bulk-retry.finish" && entry.Outcome == "completed"
	}
	if !started || !finished {
		t.Fatalf("bulk retry audit trail is incomplete: %+v", state.Audit)
	}
}

func TestBulkWebhookRetryInProgressStateBecomesInterruptedAfterRestart(t *testing.T) {
	now := time.Date(2026, 7, 27, 19, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, path := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	operation := BulkWebhookRetryResult{
		SchemaVersion: 1,
		OperationID:   "bop_restart_case",
		MerchantID:    merchant.ID,
		Actor:         merchant.PayoutAddress,
		Status:        "in_progress",
		StartedAt:     now.Add(-time.Minute),
		Source:        "explicit-confirmation-bound-webhook-retry-v1",
	}
	if err := service.store.Update(func(data *Snapshot) error {
		data.BulkOperations[operation.OperationID] = operation
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	restarted, err := New(Config{StorePath: path, IntegrityKey: bytes32(7), GatewayKey: bytes32(8), BootstrapKey: strings.Repeat("b", 24), PublicBaseURL: "https://pay.example", PayAPI: pay, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.store.View(func(data Snapshot) error {
		recovered := data.BulkOperations[operation.OperationID]
		if recovered.Status != "interrupted" || !recovered.CompletedAt.Equal(now) || recovered.Source != "restart-interrupted-webhook-retry-v1" {
			t.Fatalf("bulk retry restart recovery was incomplete: %+v", recovered)
		}
		for _, entry := range data.Audit {
			if entry.ObjectID == operation.OperationID && entry.Action == "webhook.bulk-retry.interrupted" && entry.Outcome == "interrupted" {
				return nil
			}
		}
		t.Fatal("bulk retry interruption audit was not persisted")
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func bulkRetryInputFromPreview(t *testing.T, preview BulkWebhookRetryPreview, deliveryIDs []string, operationValue string) BulkWebhookRetryInput {
	t.Helper()
	envelope := struct {
		BulkWebhookRetryPreview
		DeliveryIDs    []string `json:"deliveryIds"`
		IdempotencyKey string   `json:"idempotencyKey"`
	}{BulkWebhookRetryPreview: preview, DeliveryIDs: deliveryIDs, IdempotencyKey: operationValue}
	raw, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	var input BulkWebhookRetryInput
	if err := json.Unmarshal(raw, &input); err != nil {
		t.Fatal(err)
	}
	return input
}
