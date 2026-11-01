package payproduct

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Outbox-only integration: PUBLIC merchant/secret and actual TLS/Store. The
// notification is never a funds receipt; prior native proof evidence is reused.
func TestWebhookDelayedRetryFreshSignatureSameOriginalAfterCold(t *testing.T) {
	now := time.Date(2026, 11, 2, 1, 0, 0, 0, time.UTC)
	initial := now
	var clockMu, receiveMu sync.Mutex
	getNow := func() time.Time { clockMu.Lock(); defer clockMu.Unlock(); return now }
	setNow := func(v time.Time) { clockMu.Lock(); now = v; clockMu.Unlock() }
	s, path := testService(t, &fakePay{}, getNow)
	merchant, _ := onboard(t, s)
	secret, err := s.open(merchant.WebhookSecretCipher)
	if err != nil {
		t.Fatal(err)
	}
	var calls int
	var codes []int
	var originalBody []byte
	var originalEvent string
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receiveMu.Lock()
		defer receiveMu.Unlock()
		calls++
		body, _ := io.ReadAll(r.Body)
		id := r.Header.Get("X-YNX-Event-ID")
		stamp, e := time.Parse(time.RFC3339Nano, r.Header.Get("X-YNX-Timestamp"))
		sum := sha256.Sum256(body)
		digest := hex.EncodeToString(sum[:])
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(strings.Join([]string{"YNX_PAY_WEBHOOK_V1", id, stamp.UTC().Format(time.RFC3339Nano), digest}, "\n")))
		if e != nil || r.Header.Get("X-YNX-Payload-SHA256") != digest || !hmac.Equal([]byte(r.Header.Get("X-YNX-Signature")), []byte("v1="+hex.EncodeToString(mac.Sum(nil)))) {
			t.Error("original callback signature binding failed")
			w.WriteHeader(403)
			return
		}
		if calls == 1 {
			originalBody = append([]byte(nil), body...)
			originalEvent = id
		}
		if string(body) != string(originalBody) || id != originalEvent {
			t.Error("retry changed original event or payload")
			w.WriteHeader(409)
			return
		}
		var payload struct {
			OccurredAt time.Time `json:"occurredAt"`
		}
		if json.Unmarshal(body, &payload) != nil || !payload.OccurredAt.Equal(initial) {
			t.Error("original occurrence time changed")
			w.WriteHeader(409)
			return
		}
		code := http.StatusServiceUnavailable
		if getNow().Sub(stamp) > 5*time.Minute || stamp.After(getNow().Add(30*time.Second)) {
			code = http.StatusUnauthorized
		} else if calls >= 3 {
			code = http.StatusNoContent
		}
		codes = append(codes, code)
		w.WriteHeader(code)
	}))
	defer receiver.Close()
	s.client = receiver.Client()
	if err = s.SetWebhook(merchant, receiver.URL); err != nil {
		t.Fatal(err)
	}
	s.store.View(func(data Snapshot) error { merchant = data.Merchants[merchant.ID]; return nil })
	if err = s.queueWebhook(merchant, "native.invoice.invoice_settle", "0x"+strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	var d WebhookDelivery
	s.store.View(func(data Snapshot) error {
		for _, v := range data.Deliveries {
			d = v
		}
		return nil
	})
	original := d
	for attempt := 1; attempt <= 3; attempt++ {
		cold, e := OpenStore(path, s.key)
		if e != nil {
			t.Fatal(e)
		}
		s.store = cold
		d, err = s.Deliver(context.Background(), d.ID)
		if err != nil {
			t.Fatal(err)
		}
		if d.Attempt != attempt || d.ID != original.ID || d.Signature != original.Signature || !d.CreatedAt.Equal(original.CreatedAt) {
			t.Fatal("original retained event changed", attempt)
		}
		if attempt < 3 {
			receiveMu.Lock()
			before := calls
			receiveMu.Unlock()
			_, err = s.Deliver(context.Background(), d.ID)
			receiveMu.Lock()
			equal := calls == before
			receiveMu.Unlock()
			if err != nil || !equal {
				t.Fatal("cold retry budget bypass", err)
			}
			setNow(d.NextAttemptAt)
		}
	}
	receiveMu.Lock()
	defer receiveMu.Unlock()
	if d.Status != "delivered" || calls != 3 {
		t.Fatalf("healthy receiver after six minutes cannot receive original event: status=%s attempts=%s HTTP=%v", d.Status, strconv.Itoa(d.Attempt), codes)
	}
	if getNow().Sub(initial) != 6*time.Minute {
		t.Fatal("test did not cross original signature window")
	}
	t.Log("ACTUAL_TLS_DELAYED_ORIGINAL_CALLBACK fresh attempt signature, original event/body/occurredAt retained, cold budget unchanged, no funds")
}

func TestWebhookAttemptProofRotationAndLostAckRemainOriginal(t *testing.T) {
	var clockMu, receiveMu sync.Mutex
	now := time.Date(2026, 11, 2, 2, 0, 0, 0, time.UTC)
	getNow := func() time.Time { clockMu.Lock(); defer clockMu.Unlock(); return now }
	setNow := func(v time.Time) { clockMu.Lock(); now = v; clockMu.Unlock() }
	s, path := testService(t, &fakePay{}, getNow)
	merchant, _ := onboard(t, s)
	var calls, unique int
	seen := map[string]bool{}
	var originalBody []byte
	var originalID string
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receiveMu.Lock()
		defer receiveMu.Unlock()
		calls++
		body, _ := io.ReadAll(r.Body)
		eventID := r.Header.Get("X-YNX-Event-ID")
		disk, e := OpenStore(path, s.key)
		if e != nil {
			t.Error(e)
			w.WriteHeader(500)
			return
		}
		var persisted WebhookDelivery
		var m Merchant
		disk.View(func(data Snapshot) error {
			m = data.Merchants[merchant.ID]
			for _, v := range data.Deliveries {
				persisted = v
			}
			return nil
		})
		stamp, e := time.Parse(time.RFC3339Nano, r.Header.Get("X-YNX-Timestamp"))
		version := strconv.Itoa(m.SecretVersion)
		if e != nil || persisted.AttemptSignedAt == nil || !persisted.AttemptSignedAt.Equal(stamp) || persisted.Attempt != calls || persisted.NextAttemptAt.IsZero() || persisted.AttemptSecretVersion != m.SecretVersion || r.Header.Get("X-YNX-Signature-Version") != version || r.Header.Get("X-YNX-Signature") != "v"+version+"="+persisted.AttemptSignature {
			t.Error("attempt proof was not durable before network")
			w.WriteHeader(500)
			return
		}
		secret, e := s.open(m.WebhookSecretCipher)
		if e != nil {
			t.Error(e)
			w.WriteHeader(500)
			return
		}
		sum := sha256.Sum256(body)
		digest := hex.EncodeToString(sum[:])
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(strings.Join([]string{"YNX_PAY_WEBHOOK_V1", eventID, stamp.UTC().Format(time.RFC3339Nano), digest}, "\n")))
		if !hmac.Equal([]byte(r.Header.Get("X-YNX-Signature")), []byte("v"+version+"="+hex.EncodeToString(mac.Sum(nil)))) || getNow().Sub(stamp) > 5*time.Minute {
			t.Error("current configured callback key/window not honored")
			w.WriteHeader(401)
			return
		}
		if calls == 1 {
			originalID = eventID
			originalBody = append([]byte(nil), body...)
			w.WriteHeader(503)
			return
		}
		if eventID != originalID || string(body) != string(originalBody) {
			t.Error("attempt rotation/loss changed original event/body")
			w.WriteHeader(409)
			return
		}
		if !seen[eventID] {
			seen[eventID] = true
			unique++
		}
		w.WriteHeader(204)
	}))
	defer receiver.Close()
	s.client = receiver.Client()
	base := s.client.Transport
	brokenArchive := t.TempDir()
	s.client.Transport = webhookAttemptAckTransport{base: base, after: func() {
		receiveMu.Lock()
		n := calls
		receiveMu.Unlock()
		if n == 2 {
			s.store.path = brokenArchive
		} // same dispatch goroutine; remote ACK cannot be archived
	}}

	if err := s.SetWebhook(merchant, receiver.URL); err != nil {
		t.Fatal(err)
	}
	s.store.View(func(data Snapshot) error { merchant = data.Merchants[merchant.ID]; return nil })
	if err := s.queueWebhook(merchant, "native.invoice.invoice_refund", "0x"+strings.Repeat("b", 64)); err != nil {
		t.Fatal(err)
	}
	var original WebhookDelivery
	s.store.View(func(data Snapshot) error {
		for _, v := range data.Deliveries {
			original = v
		}
		return nil
	})
	first, err := s.Deliver(context.Background(), original.ID)
	if err != nil || first.Attempt != 1 {
		t.Fatal(err)
	}
	if _, err = s.RotateWebhookSecret(merchant); err != nil {
		t.Fatal(err)
	}
	setNow(first.NextAttemptAt)
	if _, err = s.Deliver(context.Background(), original.ID); err == nil {
		t.Fatal("lost local acknowledgement archive was claimed known")
	}
	cold, err := OpenStore(path, s.key)
	if err != nil {
		t.Fatal(err)
	}
	s.store = cold
	var reserved WebhookDelivery
	cold.View(func(data Snapshot) error { reserved = data.Deliveries[original.ID]; return nil })
	if reserved.Attempt != 2 || reserved.Status != "retrying" || reserved.AttemptSecretVersion != 2 || reserved.SecretVersion != original.SecretVersion || reserved.Signature != original.Signature || !reserved.CreatedAt.Equal(original.CreatedAt) {
		t.Fatal("cold attempt reservation replaced original event", reserved.Attempt, reserved.Status)
	}
	if _, err = s.Deliver(context.Background(), original.ID); err != nil {
		t.Fatal(err)
	}
	receiveMu.Lock()
	c := calls
	receiveMu.Unlock()
	if c != 2 {
		t.Fatal("lost ACK bypassed original retry window")
	}
	setNow(reserved.NextAttemptAt)
	delivered, err := s.Deliver(context.Background(), original.ID)
	if err != nil || delivered.Status != "delivered" || delivered.Attempt != 3 {
		t.Fatal("bounded same-event delivery did not recover", err)
	}
	receiveMu.Lock()
	defer receiveMu.Unlock()
	if calls != 3 || unique != 1 {
		t.Fatal("same signed event was applied twice", calls, unique)
	}
	t.Log("ACTUAL_TLS_ATTEMPT_ROTATION_LOST_ACK durable signing proof before eachPOST, currentkeyv2, originalsignaturev1/event/body retained, receiverinbox1, money0")
}

type webhookAttemptAckTransport struct {
	base  http.RoundTripper
	after func()
}

func (t webhookAttemptAckTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	response, err := t.base.RoundTrip(r)
	if err == nil {
		t.after()
	}
	return response, err
}

func TestWebhookSigningRotationBeforeReservationSendsNothing(t *testing.T) {
	now := time.Date(2026, 11, 2, 3, 0, 0, 0, time.UTC)
	s, _ := testService(t, &fakePay{}, func() time.Time { return now })
	m, _ := onboard(t, s)
	var calls atomic.Int32
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("X-YNX-Signature-Version") != "2" {
			t.Error("stale signing version escaped")
			w.WriteHeader(403)
			return
		}
		w.WriteHeader(204)
	}))
	defer receiver.Close()
	s.client = receiver.Client()
	if err := s.SetWebhook(m, receiver.URL); err != nil {
		t.Fatal(err)
	}
	s.store.View(func(data Snapshot) error { m = data.Merchants[m.ID]; return nil })
	if err := s.queueWebhook(m, "native.invoice.invoice_refund", "0x"+strings.Repeat("c", 64)); err != nil {
		t.Fatal(err)
	}
	var original WebhookDelivery
	s.store.View(func(data Snapshot) error {
		for _, v := range data.Deliveries {
			original = v
		}
		return nil
	})
	arm := true
	var rotationErr error
	s.now = func() time.Time {
		if arm {
			arm = false
			_, rotationErr = s.RotateWebhookSecret(m)
		}
		return now
	}
	if _, err := s.Deliver(context.Background(), original.ID); err == nil || !strings.Contains(err.Error(), "signing version changed before dispatch") {
		t.Fatal("signing rotation was not fenced", err)
	}
	if rotationErr != nil || calls.Load() != 0 {
		t.Fatal("stale attempt reached network", rotationErr, calls.Load())
	}
	s.store.View(func(data Snapshot) error {
		d := data.Deliveries[original.ID]
		if d.Attempt != 0 || d.AttemptSignedAt != nil || d.Signature != original.Signature || data.Merchants[m.ID].SecretVersion != 2 {
			t.Error("failed reservation rewrote original/attempt state")
		}
		return nil
	})
	d, err := s.Deliver(context.Background(), original.ID)
	if err != nil || d.Status != "delivered" || d.Attempt != 1 || d.AttemptSecretVersion != 2 || calls.Load() != 1 {
		t.Fatal("same pending notification did not use current signing configuration", err, calls.Load())
	}
}
