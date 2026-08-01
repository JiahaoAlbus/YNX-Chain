package payproduct

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestWebhookDeadLetterAndAuditedManualReplay(t *testing.T) {
	var healthy atomic.Bool
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !healthy.Load() {
			http.Error(w, "receiver unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer receiver.Close()
	now := time.Date(2026, 7, 22, 4, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	if err := service.SetWebhook(merchant, "https://hooks.example.test/events"); err != nil {
		t.Fatal(err)
	}
	receiverClient := receiver.Client()
	service.client = secureWebhookClient(&http.Client{Transport: roundTripRewrite{target: receiver.URL, base: receiverClient.Transport}})
	if err := service.store.View(func(data Snapshot) error { merchant = data.Merchants[merchant.ID]; return nil }); err != nil {
		t.Fatal(err)
	}
	if err := service.queueWebhook(merchant, "invoice.committed", "inv_deadlettercase00001"); err != nil {
		t.Fatal(err)
	}
	var original WebhookDelivery
	if err := service.store.View(func(data Snapshot) error {
		for _, d := range data.Deliveries {
			original = d
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		var err error
		original, err = service.Deliver(context.Background(), original.ID)
		if err != nil {
			t.Fatal(err)
		}
	}
	if original.Status != "dead_letter" || original.Attempt != 5 || original.DeadLetteredAt == nil || !original.NextAttemptAt.IsZero() {
		t.Fatalf("delivery did not enter terminal dead letter state: %+v", original)
	}
	if due := service.RetryDue(context.Background()); len(due) != 0 {
		t.Fatalf("dead letter was retried automatically: %+v", due)
	}
	actor := MerchantPrincipal{Merchant: merchant, Account: merchant.PayoutAddress, Role: "owner"}
	queued, err := service.ManualReplayWebhook(actor, original.ID, "receiver incident resolved", "manual-replay-01")
	if err != nil || queued.ID == original.ID || queued.ParentDeliveryID != original.ID || queued.ReplayedBy != actor.Account || queued.Status != "pending" {
		t.Fatalf("manual replay was not independently queued: %+v %v", queued, err)
	}
	healthy.Store(true)
	replayed, err := service.Deliver(context.Background(), queued.ID)
	if err != nil || replayed.Status != "delivered" || replayed.Attempt != 1 {
		t.Fatalf("manual replay did not deliver: %+v %v", replayed, err)
	}
	var audited bool
	_ = service.store.View(func(data Snapshot) error {
		for _, entry := range data.Audit {
			if entry.Action == "webhook.manual-replay" && entry.Actor == actor.Account && entry.ObjectID == queued.ID {
				audited = true
			}
		}
		return nil
	})
	if !audited {
		t.Fatal("manual replay audit entry is missing")
	}
	if _, err := service.ManualReplayWebhook(MerchantPrincipal{Merchant: merchant, Account: merchant.PayoutAddress, Role: "viewer"}, original.ID, "receiver incident resolved", "manual-replay-02"); err == nil {
		t.Fatal("viewer was allowed to replay a dead-letter webhook")
	}
}

func TestLegacyFailedWebhookNormalizesWithoutRetry(t *testing.T) {
	now := time.Date(2026, 7, 21, 4, 0, 0, 0, time.UTC)
	store := &Store{data: emptySnapshot()}
	store.data.Deliveries["whd_legacy"] = WebhookDelivery{ID: "whd_legacy", Status: "failed", NextAttemptAt: now.Add(time.Hour), UpdatedAt: now}
	store.normalize()
	delivery := store.data.Deliveries["whd_legacy"]
	if delivery.Status != "dead_letter" || delivery.DeadLetteredAt == nil || !delivery.DeadLetteredAt.Equal(now) || !delivery.NextAttemptAt.IsZero() {
		t.Fatalf("legacy terminal delivery did not normalize safely: %+v", delivery)
	}
}
