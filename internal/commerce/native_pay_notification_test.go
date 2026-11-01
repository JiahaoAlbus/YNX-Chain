package commerce

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func notificationRequest(t *testing.T, event string, body []byte, at time.Time, secret []byte, version int) *http.Request {
	t.Helper()
	hash := sha256.Sum256(body)
	digest := hex.EncodeToString(hash[:])
	stamp := at.UTC().Format(time.RFC3339Nano)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(strings.Join([]string{"YNX_PAY_WEBHOOK_V1", event, stamp, digest}, "\n")))
	r := httptest.NewRequest("POST", "/api/pay/notifications/native", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-YNX-Event-ID", event)
	r.Header.Set("X-YNX-Delivery-ID", event)
	r.Header.Set("X-YNX-Timestamp", stamp)
	r.Header.Set("X-YNX-Payload-SHA256", digest)
	r.Header.Set("X-YNX-Signature-Version", strconv.Itoa(version))
	r.Header.Set("X-YNX-Signature", "v"+strconv.Itoa(version)+"="+hex.EncodeToString(mac.Sum(nil)))
	return r
}

func notificationBody(t *testing.T, merchant, hash string, occurred time.Time) []byte {
	t.Helper()
	raw, err := json.Marshal(nativePayNotificationPayload{Event: "native.invoice.invoice_settle", ObjectID: hash, MerchantID: merchant, OccurredAt: occurred})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func notificationHTTP(handler http.Handler, r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func TestNativePayNotificationOriginalAttemptFreshnessColdDedupThenQualifiedReceipt(t *testing.T) {
	s, _, o, cfg, receipt, gets := nativePaymentFixture(t)
	secret := []byte(strings.Repeat("PUBLIC-", 8))
	merchant, event := "mer_original", "whd_"+strings.Repeat("a", 20)
	cfg.NativePayNotificationReceivers = []NativePayNotificationReceiver{{MerchantID: merchant, StoreID: o.StoreID, SecretVersion: 1, Secret: secret}}
	server := NewServer(s, cfg)
	now := s.now().UTC()
	body := notificationBody(t, merchant, receipt.Receipts[0].NativeHash, now.Add(-48*time.Hour))
	beforeOrder, beforeProducts := cloneOrder(s.s.Orders[o.ID]), requestHash(s.s.Products)
	for _, at := range []time.Time{now.Add(-6 * time.Minute), now.Add(time.Minute)} {
		if w := notificationHTTP(server.Handler(), notificationRequest(t, event, body, at, secret, 1)); w.Code != 401 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if len(s.s.NativePayNotifications) != 0 || *gets != 0 {
		t.Fatal("stale callback created inbox or read Pay")
	}
	if w := notificationHTTP(server.Handler(), notificationRequest(t, event, body, now, secret, 1)); w.Code != 202 || !strings.Contains(w.Body.String(), `"fundsVerified":false`) {
		t.Fatal(w.Code, w.Body.String())
	}
	if !reflect.DeepEqual(beforeOrder, s.s.Orders[o.ID]) || beforeProducts != requestHash(s.s.Products) || *gets != 0 {
		t.Fatal("notification changed money/order/stock or borrowed Pay authority")
	}
	key := nativePayNotificationKey(merchant, event)
	original := s.s.NativePayNotifications[key]
	path := s.path
	cold, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	cold.now = s.now
	if w := notificationHTTP(NewServer(cold, cfg).Handler(), notificationRequest(t, event, body, now.Add(time.Second), secret, 1)); w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	if len(cold.s.NativePayNotifications) != 1 || !reflect.DeepEqual(original, cold.s.NativePayNotifications[key]) {
		t.Fatal("retry replaced original event bytes or occurrence")
	}
	if w := readNativeReceipt(t, cold, o, cfg, "b"); w.code != 200 {
		t.Fatal(w.code, w.body)
	}
	if *gets != 1 || cold.s.Orders[o.ID].Status != "paid" || cold.s.NativePayNotifications[key].ObservedOrderID != o.ID {
		t.Fatal("same qualified receipt did not consume original hint")
	}
	after := requestHash(cold.s.Orders[o.ID])
	stock := requestHash(cold.s.Products)
	// A later original notification can arrive after its receipt was applied.
	later := "whd_" + strings.Repeat("b", 20)
	if w := notificationHTTP(NewServer(cold, cfg).Handler(), notificationRequest(t, later, body, now, secret, 1)); w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := readNativeReceipt(t, cold, o, cfg, "c"); w.code != 200 {
		t.Fatal(w.code, w.body)
	}
	if cold.s.NativePayNotifications[nativePayNotificationKey(merchant, later)].ObservedOrderID != o.ID || requestHash(cold.s.Orders[o.ID]) != after || requestHash(cold.s.Products) != stock || *gets != 2 {
		t.Fatal("duplicate original receipt reapplied money/timeline/stock or failed pending hint")
	}
	if _, err = Open(path); err != nil {
		t.Fatal("cold observed inbox", err)
	}
	cold.mu.Lock()
	_, err = cold.rollbackSnapshotLocked(17)
	cold.mu.Unlock()
	if err == nil {
		t.Fatal("older snapshot can drop durable original inbox")
	}
}

func TestNativePayNotificationRejectsTamperAndConcurrentDuplicateWithoutFinancialAuthority(t *testing.T) {
	s, _, o, cfg, receipt, gets := nativePaymentFixture(t)
	secret := []byte(strings.Repeat("PUBLIC-", 8))
	merchant, event := "mer_original", "whd_"+strings.Repeat("a", 20)
	now := s.now().UTC()
	body := notificationBody(t, merchant, receipt.Receipts[0].NativeHash, now)
	cfg.NativePayNotificationReceivers = []NativePayNotificationReceiver{{MerchantID: merchant, StoreID: o.StoreID, SecretVersion: 2, Secret: secret}}
	server := NewServer(s, cfg)
	for _, mode := range []string{"signature", "hash", "duplicate-header", "version", "delivery", "extra-field", "query", "missing-config"} {
		r := notificationRequest(t, event, body, now, secret, 2)
		handler := server.Handler()
		switch mode {
		case "signature":
			r.Header.Set("X-YNX-Signature", "v2="+strings.Repeat("0", 64))
		case "hash":
			r.Header.Set("X-YNX-Payload-SHA256", strings.Repeat("0", 64))
		case "duplicate-header":
			r.Header.Add("X-YNX-Event-ID", event)
		case "version":
			r = notificationRequest(t, event, body, now, secret, 1)
		case "delivery":
			r.Header.Set("X-YNX-Delivery-ID", "whd_"+strings.Repeat("b", 20))
		case "extra-field":
			r = notificationRequest(t, event, append(bytes.TrimSuffix(body, []byte("}")), []byte(`,"paidAtoms":"100"}`)...), now, secret, 2)
		case "query":
			r.URL.RawQuery = "order=foreign"
		case "missing-config":
			handler = NewServer(s, ServerConfig{}).Handler()
		}
		if w := notificationHTTP(handler, r); w.Code < 400 {
			t.Fatal(mode, w.Code, w.Body.String())
		}
		if len(s.s.NativePayNotifications) != 0 || *gets != 0 {
			t.Fatal(mode, "callback applied or read funds")
		}
	}
	var wg sync.WaitGroup
	codes := make(chan int, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes <- notificationHTTP(server.Handler(), notificationRequest(t, event, body, now, secret, 2)).Code
		}()
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 202 {
			t.Fatal(code)
		}
	}
	if len(s.s.NativePayNotifications) != 1 || *gets != 0 || s.s.Orders[o.ID].Status != "payment_pending" {
		t.Fatal("concurrent notification creates funds or duplicate")
	}
	changed := notificationBody(t, merchant, "0x"+strings.Repeat("b", 64), now)
	if w := notificationHTTP(server.Handler(), notificationRequest(t, event, changed, now, secret, 2)); w.Code != 409 {
		t.Fatal("same root event substituted", w.Code, w.Body.String())
	}
	// External configuration edits cannot silently rotate a live receiver.
	cfg.NativePayNotificationReceivers[0].Secret[0] ^= 1
	if w := notificationHTTP(server.Handler(), notificationRequest(t, event, body, now, []byte(strings.Repeat("PUBLIC-", 8)), 2)); w.Code != 202 {
		t.Fatal("receiver aliases mutable caller key")
	}
}

func TestNativePayNotificationPersistenceFailureAndColdObservedForgeryFailClosed(t *testing.T) {
	s, _, o, cfg, receipt, _ := nativePaymentFixture(t)
	merchant, event := "mer_original", "whd_"+strings.Repeat("a", 20)
	now := s.now().UTC()
	body := notificationBody(t, merchant, receipt.Receipts[0].NativeHash, now)
	hash := sha256.Sum256(body)
	record := NativePayNotification{EventID: event, MerchantID: merchant, StoreID: o.StoreID, NativeHash: receipt.Receipts[0].NativeHash, Kind: "invoice_settle", PayloadSHA256: hex.EncodeToString(hash[:]), Payload: body, ReceivedAt: now}
	path := s.path
	s.path = t.TempDir()
	before := requestHash(s.s)
	if err := s.stageNativePayNotification(record); err == nil {
		t.Fatal("failed durable inbox accepted")
	}
	if requestHash(s.s) != before {
		t.Fatal("failed save left partial original notification")
	}
	s.path = path
	if err := s.stageNativePayNotification(record); err != nil {
		t.Fatal(err)
	}
	bad, _ := cloneSnapshot(s.s)
	record.ObservedOrderID = o.ID
	bad.NativePayNotifications[nativePayNotificationKey(merchant, event)] = record
	if validateNativePayNotifications(bad) == nil {
		t.Fatal("flat callback forged receipt observation")
	}
	if w := readNativeReceipt(t, s, o, cfg, "b"); w.code != 200 {
		t.Fatal(w.code, w.body)
	}
	older, _ := cloneSnapshot(s.s)
	delete(older.NativePayNotifications, nativePayNotificationKey(merchant, event))
	if containsRetiredIntents(older, s.s) {
		t.Fatal("backup restore discarded original notification")
	}
	oldSchema, _ := cloneSnapshot(s.s)
	oldSchema.Version = 17
	if _, err := (&Store{s: oldSchema}).normalize(); err == nil {
		t.Fatal("downgraded schema marker can lose inbox on older writer")
	}
	late := record
	late.EventID = "whd_" + strings.Repeat("b", 20)
	late.ObservedOrderID = ""
	if err := s.stageNativePayNotification(late); err != nil {
		t.Fatal(err)
	}
	before = requestHash(s.s)
	s.path = t.TempDir()
	payment := *s.s.Orders[o.ID].NativePayment
	if _, err := s.applyNativePaymentReceipt(s.s.Orders[o.ID].Buyer, o.ID, payment); err == nil {
		t.Fatal("failed observation commit acknowledged original hint")
	}
	if requestHash(s.s) != before {
		t.Fatal("failed observation commit changed original state")
	}
	s.path = path
	if _, err := s.applyNativePaymentReceipt(s.s.Orders[o.ID].Buyer, o.ID, payment); err != nil {
		t.Fatal(err)
	}
	if s.s.NativePayNotifications[nativePayNotificationKey(merchant, late.EventID)].ObservedOrderID != o.ID {
		t.Fatal("same receipt retry failed original hint")
	}
}

func TestNativePayNotificationExactP06ReferenceLocatesButNeverAuthorizesOrder(t *testing.T) {
	s, _, o, cfg, receipt, gets := nativePaymentFixture(t)
	secret := []byte(strings.Repeat("PUBLIC-", 8))
	merchant := "mer_original"
	now := s.now().UTC()
	row := receipt.Receipts[0]
	cfg.NativePayNotificationReceivers = []NativePayNotificationReceiver{{MerchantID: merchant, StoreID: o.StoreID, SecretVersion: 1, Secret: secret}}
	ref := nativePayNotificationReference{Version: "ynx.pay.native.webhook-reference/v1", Genesis: row.Genesis, NativeChainID: row.NativeChainID, Merchant: row.Merchant, InvoiceID: row.InvoiceID, SessionID: row.SessionID, SourceOrder: o.ID, NativeHash: row.NativeHash, ABCIHash: row.ABCIHash, EventClaim: row.EventClaim}
	body := func(r nativePayNotificationReference) []byte {
		raw, err := json.Marshal(nativePayNotificationPayload{Event: "native.invoice.invoice_settle", ObjectID: row.NativeHash, MerchantID: merchant, OccurredAt: now.Add(-48 * time.Hour), NativeInvoice: &r})
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	h := NewServer(s, cfg).Handler()
	validEvent := "whd_" + strings.Repeat("a", 20)
	if w := notificationHTTP(h, notificationRequest(t, validEvent, body(ref), now, secret, 1)); w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	if *gets != 0 || s.s.Orders[o.ID].NativePayment != nil {
		t.Fatal("P06 reference became receipt authority")
	}
	wrong := ref
	wrong.SourceOrder = "foreign-order"
	if w := notificationHTTP(h, notificationRequest(t, "whd_"+strings.Repeat("b", 20), body(wrong), now, secret, 1)); w.Code != 404 {
		t.Fatal("foreign original order reference", w.Code, w.Body.String())
	}
	wrong = ref
	wrong.InvoiceID = "another-invoice"
	if w := notificationHTTP(h, notificationRequest(t, "whd_"+strings.Repeat("c", 20), body(wrong), now, secret, 1)); w.Code != 409 {
		t.Fatal("different invoice reference", w.Code, w.Body.String())
	}
	wrong = ref
	wrong.SessionID = "other-session"
	wrongEvent := "whd_" + strings.Repeat("d", 20)
	if w := notificationHTTP(h, notificationRequest(t, wrongEvent, body(wrong), now, secret, 1)); w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := readNativeReceipt(t, s, o, cfg, "b"); w.code != 200 {
		t.Fatal(w.code, w.body)
	}
	if *gets != 1 || s.s.NativePayNotifications[nativePayNotificationKey(merchant, validEvent)].ObservedOrderID != o.ID || s.s.NativePayNotifications[nativePayNotificationKey(merchant, wrongEvent)].ObservedOrderID != "" {
		t.Fatal("unmatched session hint acknowledged by independent receipt")
	}
	if _, err := Open(s.path); err != nil {
		t.Fatal("cold exact-reference inbox", err)
	}
}
