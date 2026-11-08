package payproduct

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestWebhookRetryBudgetSurvivesColdStoreAndDirectCalls(t *testing.T) {
	var calls atomic.Int32
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(503) }))
	defer receiver.Close()
	now := time.Date(2026, 10, 31, 10, 0, 0, 0, time.UTC)
	s, path := testService(t, &fakePay{}, func() time.Time { return now })
	s.client = receiver.Client()
	m, _ := onboard(t, s)
	m.WebhookURL = receiver.URL
	if err := s.SetWebhook(m, receiver.URL); err != nil {
		t.Fatal(err)
	}
	if err := s.queueWebhook(m, "invoice.committed", "inv_original"); err != nil {
		t.Fatal(err)
	}
	var d WebhookDelivery
	s.store.View(func(data Snapshot) error {
		for _, v := range data.Deliveries {
			d = v
		}
		return nil
	})
	for i := 1; i <= 5; i++ {
		var err error
		d, err = s.Deliver(context.Background(), d.ID)
		if err != nil {
			t.Fatal(err)
		}
		if d.Attempt != i {
			t.Fatalf("attempt %d wanted %d", d.Attempt, i)
		}
		before := calls.Load()
		if _, err = s.Deliver(context.Background(), d.ID); err != nil {
			t.Fatal(err)
		}
		if calls.Load() != before {
			t.Fatal("direct delivery bypassed retry delay or terminal dead letter")
		}
		reopened, err := OpenStore(path, s.key)
		if err != nil {
			t.Fatal(err)
		}
		s.store = reopened
		if i < 5 {
			now = d.NextAttemptAt
		}
	}
	if due := s.RetryDue(context.Background()); len(due) != 0 || calls.Load() != 5 {
		t.Fatal("cold dead letter retried", calls.Load())
	}
}

func TestWebhookPersistsAttemptBeforeSending(t *testing.T) {
	var calls atomic.Int32
	now := time.Date(2026, 10, 31, 10, 0, 0, 0, time.UTC)
	s, path := testService(t, &fakePay{}, func() time.Time { return now })
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		disk, err := OpenStore(path, s.key)
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		disk.View(func(data Snapshot) error {
			for _, d := range data.Deliveries {
				if d.Attempt != 1 || d.NextAttemptAt.IsZero() {
					t.Error("outbound attempt was not durably reserved")
				}
			}
			return nil
		})
		// Simulate remote success followed by failure to archive the response.
		s.store.path = t.TempDir()
		w.WriteHeader(204)
	}))
	defer receiver.Close()
	s.client = receiver.Client()
	m, _ := onboard(t, s)
	m.WebhookURL = receiver.URL
	if err := s.SetWebhook(m, receiver.URL); err != nil {
		t.Fatal(err)
	}
	if err := s.queueWebhook(m, "invoice.committed", "inv_original"); err != nil {
		t.Fatal(err)
	}
	var id string
	s.store.View(func(data Snapshot) error {
		for k := range data.Deliveries {
			id = k
		}
		return nil
	})
	if _, err := s.Deliver(context.Background(), id); err == nil {
		t.Fatal("response archival failure was ignored")
	}
	reopened, err := OpenStore(path, s.key)
	if err != nil {
		t.Fatal(err)
	}
	s.store = reopened
	if _, err = s.Deliver(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatal("cold response loss bypassed reserved retry delay")
	}
}

func TestWebhookManualReplayKeepsOriginalSignedEvent(t *testing.T) {
	var bodies [][]byte
	var events []string
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, b)
		events = append(events, r.Header.Get("X-YNX-Event-ID"))
		w.WriteHeader(503)
	}))
	defer receiver.Close()
	now := time.Date(2026, 10, 31, 10, 0, 0, 0, time.UTC)
	s, _ := testService(t, &fakePay{}, func() time.Time { return now })
	s.client = receiver.Client()
	m, _ := onboard(t, s)
	m.WebhookURL = receiver.URL
	s.store.Update(func(data *Snapshot) error { data.Merchants[m.ID] = m; return nil })
	if err := s.queueWebhook(m, "invoice.committed", "inv_original"); err != nil {
		t.Fatal(err)
	}
	var d WebhookDelivery
	s.store.View(func(data Snapshot) error {
		for _, v := range data.Deliveries {
			d = v
		}
		return nil
	})
	for range 5 {
		var err error
		d, err = s.Deliver(context.Background(), d.ID)
		if err != nil {
			t.Fatal(err)
		}
		now = d.NextAttemptAt
		if now.IsZero() {
			now = d.UpdatedAt.Add(time.Minute)
		}
	}
	replay, err := s.ManualReplayWebhook(MerchantPrincipal{Merchant: m, Account: m.PayoutAddress, Role: "owner"}, d.ID, "receiver recovered now", "manual-original-event")
	if err != nil {
		t.Fatal(err)
	}
	secret, err := s.open(m.WebhookSecretCipher)
	if err != nil {
		t.Fatal(err)
	}
	if replay.Signature != hmacHex([]byte(secret), webhookSigningMaterial(events[0], replay.CreatedAt, hexSHA(bodies[0]))) {
		t.Fatal("manual replay signature lost original event binding")
	}
	if _, err = s.Deliver(context.Background(), replay.ID); err != nil {
		t.Fatal(err)
	}
	if events[0] != events[len(events)-1] || string(bodies[0]) != string(bodies[len(bodies)-1]) {
		t.Fatal("manual replay minted a second business event or changed its payload")
	}
}

func TestWebhookOutboxAtomicAndRotationRetainsEvent(t *testing.T) {
	now := time.Date(2026, 10, 31, 10, 0, 0, 0, time.UTC)
	s, path := testService(t, &fakePay{}, func() time.Time { return now })
	m, _ := onboard(t, s)
	m.WebhookURL = "https://merchant.example/webhook"
	broken := m
	broken.WebhookSecretCipher = "invalid"
	err := s.store.Update(func(data *Snapshot) error {
		data.Invoices["inv_atomic"] = Invoice{ID: "inv_atomic", Status: "committed"}
		return s.enqueueWebhook(data, broken, "invoice.committed", "inv_atomic")
	})
	if err == nil {
		t.Fatal("broken outbox signature committed business state")
	}
	s.store.View(func(data Snapshot) error {
		if _, ok := data.Invoices["inv_atomic"]; ok {
			t.Fatal("business state survived failed outbox transaction")
		}
		return nil
	})
	if err := s.store.Update(func(data *Snapshot) error {
		data.Invoices["inv_atomic"] = Invoice{ID: "inv_atomic", Status: "committed"}
		return s.enqueueWebhook(data, m, "invoice.committed", "inv_atomic")
	}); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(path, s.key)
	if err != nil {
		t.Fatal(err)
	}
	s.store = reopened
	m.SecretVersion++
	m.WebhookSecretCipher = s.seal("rotated-secret")
	now = now.Add(time.Hour)
	if err = s.queueWebhook(m, "invoice.committed", "inv_atomic"); err != nil {
		t.Fatal(err)
	}
	s.store.View(func(data Snapshot) error {
		if data.Invoices["inv_atomic"].Status != "committed" || len(data.Deliveries) != 1 {
			t.Fatal("cold outbox or rotated original event lost")
		}
		return nil
	})
}
