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
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestWebhookNativeReferenceDeadLetterReplayKeepsOriginal(t *testing.T) {
	var clockMu, receiveMu sync.Mutex
	now := time.Date(2026, 11, 2, 4, 0, 0, 0, time.UTC)
	initial := now
	getNow := func() time.Time { clockMu.Lock(); defer clockMu.Unlock(); return now }
	setNow := func(v time.Time) { clockMu.Lock(); now = v; clockMu.Unlock() }
	s, path := testService(t, &fakePay{}, getNow)
	m, _ := onboard(t, s)
	secret, err := s.open(m.WebhookSecretCipher)
	if err != nil {
		t.Fatal(err)
	}
	expected := NativeWebhookReference{Version: "ynx.pay.native.webhook-reference/v1", Genesis: strings.Repeat("a", 64), NativeChainID: "6423", Merchant: "0x" + strings.Repeat("1", 40), InvoiceID: "invoice-original", SessionID: "session-original", SourceOrder: "order:original", NativeHash: "0x" + strings.Repeat("b", 64), ABCIHash: "0x" + strings.Repeat("c", 64), EventClaim: strings.Repeat("d", 64)}
	var healthy atomic.Bool
	var calls, unique int
	var originalID string
	var bodyOriginal []byte
	seen := map[string]bool{}
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receiveMu.Lock()
		defer receiveMu.Unlock()
		calls++
		body, _ := io.ReadAll(r.Body)
		id := r.Header.Get("X-YNX-Event-ID")
		at, e := time.Parse(time.RFC3339Nano, r.Header.Get("X-YNX-Timestamp"))
		sum := sha256.Sum256(body)
		digest := hex.EncodeToString(sum[:])
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(strings.Join([]string{"YNX_PAY_WEBHOOK_V1", id, at.UTC().Format(time.RFC3339Nano), digest}, "\n")))
		if e != nil || getNow().Sub(at) > 5*time.Minute || !hmac.Equal([]byte(r.Header.Get("X-YNX-Signature")), []byte("v1="+hex.EncodeToString(mac.Sum(nil)))) {
			t.Error("callback original/window signature invalid")
			w.WriteHeader(401)
			return
		}
		var value struct {
			Native     *NativeWebhookReference `json:"nativeInvoice"`
			OccurredAt time.Time               `json:"occurredAt"`
		}
		if json.Unmarshal(body, &value) != nil || value.Native == nil || *value.Native != expected || !value.OccurredAt.Equal(initial) {
			t.Error("exact invoice/session reference was replaced")
			w.WriteHeader(409)
			return
		}
		if calls == 1 {
			originalID = id
			bodyOriginal = append([]byte(nil), body...)
		}
		if id != originalID || string(body) != string(bodyOriginal) {
			t.Error("deadletter replay minted new reference/event/body")
			w.WriteHeader(409)
			return
		}
		if !healthy.Load() {
			w.WriteHeader(503)
			return
		}
		if !seen[id] {
			seen[id] = true
			unique++
		}
		w.WriteHeader(204)
	}))
	defer receiver.Close()
	s.client = receiver.Client()
	if err = s.SetWebhook(m, receiver.URL); err != nil {
		t.Fatal(err)
	}
	s.store.View(func(data Snapshot) error { m = data.Merchants[m.ID]; return nil })
	input := expected
	if err = s.store.Update(func(data *Snapshot) error {
		return s.enqueueWebhookReference(data, m, "native.invoice.invoice_refund", expected.NativeHash, &input)
	}); err != nil {
		t.Fatal(err)
	}
	input.SourceOrder = "mutated-after-enqueue"
	var d WebhookDelivery
	s.store.View(func(data Snapshot) error {
		for _, v := range data.Deliveries {
			d = v
		}
		return nil
	})
	for attempt := 1; attempt <= 5; attempt++ {
		d, err = s.Deliver(context.Background(), d.ID)
		if err != nil || d.Attempt != attempt {
			t.Fatal("bounded original dispatch", err, d.Attempt)
		}
		cold, e := OpenStore(path, s.key)
		if e != nil {
			t.Fatal(e)
		}
		s.store = cold
		if attempt < 5 {
			setNow(d.NextAttemptAt)
		}
	}
	if d.Status != "dead_letter" || len(s.RetryDue(context.Background())) != 0 {
		t.Fatal("terminal original escaped deadletter")
	}
	// Explicit authorized delivery replay only. This never authorizes money.
	child, err := s.ManualReplayWebhook(MerchantPrincipal{Merchant: m, Account: m.PayoutAddress, Role: "owner"}, d.ID, "PUBLIC receiver now recovered", "native-reference-replay")
	if err != nil || child.ParentDeliveryID != d.ID || child.NativeInvoice == nil || *child.NativeInvoice != expected {
		t.Fatal("manual replay lost original reference", err)
	}
	child.NativeInvoice.SourceOrder = "mutated-returned-result" // cannot mutate durable receiver reference
	setNow(getNow().Add(time.Hour))
	healthy.Store(true)
	done, err := s.Deliver(context.Background(), child.ID)
	if err != nil || done.Status != "delivered" || done.NativeInvoice.SourceOrder != expected.SourceOrder {
		t.Fatal("cold manual child failed original read reference", err)
	}
	done.NativeInvoice.SourceOrder = "mutated-delivery-result"
	cold, err := OpenStore(path, s.key)
	if err != nil {
		t.Fatal(err)
	}
	s.store = cold
	same, err := s.ManualReplayWebhook(MerchantPrincipal{Merchant: m, Account: m.PayoutAddress, Role: "owner"}, d.ID, "PUBLIC receiver now recovered", "native-reference-replay")
	if err != nil || same.ID != child.ID || same.NativeInvoice.SourceOrder != expected.SourceOrder {
		t.Fatal("cold idempotent replay lost original child/ref", err)
	}
	if len(s.RetryDue(context.Background())) != 0 {
		t.Fatal("delivered child or dead root replayed automatically")
	}
	receiveMu.Lock()
	defer receiveMu.Unlock()
	if calls != 6 || unique != 1 {
		t.Fatal("original notification applied more than once", calls, unique)
	}
	t.Log("ACTUAL_TLS_NATIVE_REFERENCE deadletter5/cold/manualchild1/sameeventbodyandinvoice/receiverinbox1; callbacknotfunds=true")
}

func TestWebhookReplayCannotSpliceNativeReference(t *testing.T) {
	root := WebhookDelivery{ID: "root-original", MerchantID: "merchant-original", EventType: "native.invoice.invoice_refund", ObjectID: "original-hash", NativeInvoice: &NativeWebhookReference{SourceOrder: "order-original"}}
	child := root
	child.ID = "child-replay"
	child.ParentDeliveryID = root.ID
	ref := *root.NativeInvoice
	ref.SourceOrder = "other-order"
	child.NativeInvoice = &ref
	data := emptySnapshot()
	data.Deliveries[root.ID] = root
	data.Deliveries[child.ID] = child
	if _, err := webhookEvent(data, child.ID); err == nil {
		t.Fatal("manual child changed original native invoice reference")
	}
}
