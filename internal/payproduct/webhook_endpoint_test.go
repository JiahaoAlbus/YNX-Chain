package payproduct

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestWebhookEndpointRevocationSurvivesColdAndStaleMerchant(t *testing.T) {
	for _, replacement := range []string{"", "https://replacement.example/webhook"} {
		t.Run(replacement, func(t *testing.T) {
			var calls atomic.Int32
			receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.WriteHeader(204)
			}))
			defer receiver.Close()
			s, path := testService(t, &fakePay{}, time.Now)
			s.client = receiver.Client()
			m, _ := onboard(t, s)
			if err := s.SetWebhook(m, receiver.URL); err != nil {
				t.Fatal(err)
			}
			if err := s.store.View(func(data Snapshot) error { m = data.Merchants[m.ID]; return nil }); err != nil {
				t.Fatal(err)
			}
			if err := s.queueWebhook(m, "invoice.committed", "inv_revoked_original"); err != nil {
				t.Fatal(err)
			}
			var original WebhookDelivery
			_ = s.store.View(func(data Snapshot) error {
				for _, d := range data.Deliveries {
					original = d
				}
				return nil
			})
			if err := s.SetWebhook(m, replacement); err != nil {
				t.Fatal(err)
			}
			// A previously authenticated merchant copy must not restore its old
			// endpoint while rotating an otherwise current signing secret.
			if _, err := s.RotateWebhookSecret(m); err != nil {
				t.Fatal(err)
			}
			cold, err := OpenStore(path, s.key)
			if err != nil {
				t.Fatal(err)
			}
			s.store = cold
			_ = s.RetryDue(context.Background())
			_ = s.store.View(func(data Snapshot) error {
				d := data.Deliveries[original.ID]
				if calls.Load() != 0 || d.Status != "dead_letter" || d.Attempt != 0 || d.DeadLetteredAt == nil || !d.NextAttemptAt.IsZero() || d.Endpoint != original.Endpoint || d.Signature != original.Signature || d.PayloadHash != original.PayloadHash {
					t.Errorf("revoked endpoint dispatched or original event changed: calls=%d delivery=%+v", calls.Load(), d)
				}
				if current := data.Merchants[m.ID]; current.WebhookURL != replacement || current.SecretVersion != 2 {
					t.Error("stale merchant restored revoked endpoint or signing version", current.WebhookURL, current.SecretVersion)
				}
				return nil
			})
		})
	}
}

func TestWebhookEndpointRevocationDuringDispatchCannotRestoreRetry(t *testing.T) {
	s, path := testService(t, &fakePay{}, time.Now)
	m, _ := onboard(t, s)
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.SetWebhook(m, ""); err != nil {
			t.Error(err)
		}
		w.WriteHeader(503)
	}))
	defer receiver.Close()
	s.client = receiver.Client()
	if err := s.SetWebhook(m, receiver.URL); err != nil {
		t.Fatal(err)
	}
	_ = s.store.View(func(data Snapshot) error { m = data.Merchants[m.ID]; return nil })
	if err := s.queueWebhook(m, "invoice.committed", "inv_inflight_original"); err != nil {
		t.Fatal(err)
	}
	var original WebhookDelivery
	_ = s.store.View(func(data Snapshot) error {
		for _, d := range data.Deliveries {
			original = d
		}
		return nil
	})
	d, err := s.Deliver(context.Background(), original.ID)
	if err != nil {
		t.Fatal(err)
	}
	cold, err := OpenStore(path, s.key)
	if err != nil {
		t.Fatal(err)
	}
	_ = cold.View(func(data Snapshot) error {
		stored := data.Deliveries[d.ID]
		if stored.Status != "dead_letter" || stored.Attempt != 1 || stored.HTTPStatus != 503 || stored.DeadLetteredAt == nil || !stored.NextAttemptAt.IsZero() {
			t.Errorf("late failed response rearmed revoked endpoint: %+v", stored)
		}
		return nil
	})
}

func TestWebhookDefaultTransportBlocksPrivateRecipient(t *testing.T) {
	var calls atomic.Int32
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(204) }))
	defer receiver.Close()
	s, _ := testService(t, &fakePay{}, time.Now)
	m, _ := onboard(t, s)
	if err := s.SetWebhook(m, receiver.URL); err != nil {
		t.Fatal(err)
	}
	_ = s.store.View(func(data Snapshot) error { m = data.Merchants[m.ID]; return nil })
	if err := s.queueWebhook(m, "invoice.committed", "inv_ssrf_original"); err != nil {
		t.Fatal(err)
	}
	var id string
	_ = s.store.View(func(data Snapshot) error {
		for key := range data.Deliveries {
			id = key
		}
		return nil
	})
	_, _ = s.Deliver(context.Background(), id)
	var blocked bool
	_ = s.store.View(func(data Snapshot) error {
		for _, entry := range data.Audit {
			if entry.Action == "webhook.deliver" && entry.ObjectID == id && strings.Contains(entry.Outcome, "webhook target address is not public") {
				blocked = true
			}
		}
		return nil
	})
	if calls.Load() != 0 || !blocked {
		t.Fatal("default callback transport did not reject private target before TLS", calls.Load(), blocked)
	}
}

func TestWebhookConfigurationUsesCurrentMerchantAndReservationFence(t *testing.T) {
	s, _ := testService(t, &fakePay{}, time.Now)
	m, _ := onboard(t, s)
	var calls atomic.Int32
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(204) }))
	defer receiver.Close()
	s.client = receiver.Client()
	if _, err := s.RotateWebhookSecret(m); err != nil {
		t.Fatal(err)
	}
	if err := s.SetWebhook(m, receiver.URL); err != nil {
		t.Fatal(err)
	}
	_ = s.store.View(func(data Snapshot) error {
		if data.Merchants[m.ID].SecretVersion != 2 {
			t.Error("endpoint update restored stale signing version")
		}
		m = data.Merchants[m.ID]
		return nil
	})
	if err := s.queueWebhook(m, "invoice.committed", "inv_fence_original"); err != nil {
		t.Fatal(err)
	}
	var id string
	_ = s.store.View(func(data Snapshot) error {
		for key := range data.Deliveries {
			id = key
		}
		return nil
	})
	at := time.Now()
	armed := true
	s.now = func() time.Time {
		if armed {
			armed = false
			if err := s.SetWebhook(m, ""); err != nil {
				t.Error(err)
			}
		}
		return at
	}
	if _, err := s.Deliver(context.Background(), id); err == nil || !strings.Contains(err.Error(), "endpoint revoked before dispatch") {
		t.Fatal("reservation accepted endpoint revoked after read", err)
	}
	_ = s.store.View(func(data Snapshot) error {
		d := data.Deliveries[id]
		if calls.Load() != 0 || d.Attempt != 0 || d.AttemptSignedAt != nil || d.Status != "dead_letter" {
			t.Error("revocation reservation consumed budget or sent POST", calls.Load(), d)
		}
		return nil
	})
	if err := s.store.Update(func(data *Snapshot) error {
		current := data.Merchants[m.ID]
		current.Status = "inactive"
		data.Merchants[m.ID] = current
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetWebhook(m, receiver.URL); err == nil {
		t.Fatal("stale merchant reactivated endpoint")
	}
	if _, err := s.RotateWebhookSecret(m); err == nil {
		t.Fatal("stale merchant reactivated signing")
	}
}
