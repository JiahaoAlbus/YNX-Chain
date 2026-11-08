package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNativeOrderCancellationBeforeInvoiceStillReleasesOriginalStock(t *testing.T) {
	s, buyer, o := effectOrderFixture(t, "")
	_, e := s.transition(buyer, "buyer", o.ID, "cancelled", nil, nil, nil, "local-uninvoiced-cancel")
	if e != nil {
		t.Fatal(e)
	}
	if s.s.Orders[o.ID].Status != "cancelled" {
		t.Fatal("local cancellation not applied")
	}
	for _, line := range o.Lines {
		for _, v := range s.s.Products[line.ProductID].Variants {
			if v.ID == line.VariantID && v.Reserved != 0 {
				t.Fatal("local uninvoiced stock not released")
			}
		}
	}
}

func TestNativeOrderCancellationAndExpiryHoldBoundOriginalAcrossRestart(t *testing.T) {
	s, buyer, o, _, _, _ := nativePaymentFixture(t)
	before, _ := json.Marshal(s.s)
	if _, e := s.transition(buyer, "buyer", o.ID, "cancelled", nil, nil, nil, "bound-native-local-cancel"); e == nil {
		t.Fatal("bound invoice cancellation allowed")
	}
	after, _ := json.Marshal(s.s)
	if !bytes.Equal(before, after) {
		t.Fatal("refused cancellation changed original order/stock/journal")
	}
	originalNow := s.now
	s.now = func() time.Time { return o.ReservationExpiresAt.Add(time.Hour) }
	if e := s.Recover(); e != nil {
		t.Fatal(e)
	}
	after, _ = json.Marshal(s.s)
	if !bytes.Equal(before, after) {
		t.Fatal("local expiry changed bound original or released its stock")
	}
	s.now = originalNow
	cold, e := Open(s.path)
	if e != nil {
		t.Fatal(e)
	}
	warmJSON, _ := json.Marshal(s.s)
	coldJSON, _ := json.Marshal(cold.s)
	if !bytes.Equal(warmJSON, coldJSON) {
		t.Fatalf("cold open changed durable original: warm=%s cold=%s", warmJSON, coldJSON)
	}
	if _, e = cold.transition(buyer, "buyer", o.ID, "cancelled", nil, nil, nil, "bound-native-cold-cancel"); e == nil {
		t.Fatal("cold original cancelled")
	}
}

func TestNativeOrderCancellationWhileFirstInvoiceUnknownNeverReleasesOrReplays(t *testing.T) {
	s, buyer, o, cfg, _, _ := nativePaymentFixture(t)
	// Use a second uninvoiced original order from the same real Store fixture.
	old := o
	input := OrderInput{StoreID: o.StoreID, Items: []CartItem{{ProductID: o.Lines[0].ProductID, VariantID: o.Lines[0].VariantID, Quantity: 1}}, Address: o.Address, IdempotencyKey: "second-controlled-original-order"}
	o, e := s.CreateOrder(buyer, input)
	if e != nil {
		t.Fatal(e)
	}
	reached, release := make(chan struct{}), make(chan struct{})
	calls := 0
	cfg.NativePay = nativeIntentObservationClient(t, func(r *http.Request) (*http.Response, error) {
		calls++
		close(reached)
		<-release
		return nil, context.DeadlineExceeded
	})
	server := NewServer(s, cfg)
	done := make(chan int, 1)
	go func() {
		w := businessHTTPRequest(server, "POST", "/api/orders/"+o.ID+"/native-pay-intent", strings.Repeat("c", 43), `{"IdempotencyKey":"PUBLIC-held-native-original"}`)
		done <- w.Code
	}()
	<-reached
	projection, e := s.Order(buyer, "buyer", o.ID)
	if e != nil || !projection.LocalCancellationBlocked {
		t.Fatal("fresh-device normal order read hid pending native cancellation fence", e)
	}
	// Native admission/dispatch is already durable while this remote call is
	// unresolved. Concurrent local cancellation must share that same Store lock.
	s.mu.Lock()
	stock, _ := json.Marshal(s.s.Products)
	s.mu.Unlock()
	cancelled := businessHTTPRequest(server, "POST", "/api/orders/"+o.ID+"/transition", strings.Repeat("d", 43), `{"Action":"cancelled","IdempotencyKey":"PUBLIC-cancel-during-unknown"}`)
	if cancelled.Code < 400 {
		t.Fatal("in-flight invoice locally cancelled", cancelled.Code)
	}
	close(release)
	if code := <-done; code < 400 {
		t.Fatal("lost response reported success", code)
	}
	s.mu.Lock()
	nowStock, _ := json.Marshal(s.s.Products)
	original := s.s.Orders[o.ID]
	untouched := s.s.Orders[old.ID]
	s.mu.Unlock()
	if !bytes.Equal(stock, nowStock) || original.Status != "payment_pending" || untouched.ID != old.ID || calls != 1 {
		t.Fatal("UNKNOWN cancellation released stock/replaced or resent original")
	}
	before, _ := os.ReadFile(s.path)
	cold, e := Open(s.path)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = cold.transition(buyer, "buyer", o.ID, "cancelled", nil, nil, nil, "PUBLIC-cold-cancel-unknown"); e == nil {
		t.Fatal("cold UNKNOWN locally cancelled")
	}
	after, _ := os.ReadFile(s.path)
	if !bytes.Equal(before, after) {
		t.Fatal("cold cancellation changed original disk")
	}
}

func TestNativeOrderCancellationExpiredUnknownRecoversOnlyOriginalBinding(t *testing.T) {
	s, buyer, o := effectOrderFixture(t, filepath.Join(t.TempDir(), "original.json"))
	creates, lookups := 0, 0
	var captured NativeShopInvoiceRequestDATA
	pay := nativeIntentObservationClient(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v5/pay/invoice-intents" {
			creates++
			b, _ := io.ReadAll(r.Body)
			if json.Unmarshal(b, &captured) != nil {
				t.Fatal("bad original request")
			}
			return nil, context.DeadlineExceeded
		}
		if r.URL.Path != "/v5/pay/invoice-intents/lookup" {
			t.Fatal("unexpected Pay route", r.URL.Path)
		}
		lookups++
		return nativeShopPayResponse(200, publicNativeInvoiceResponse(captured)), nil
	})
	cfg := ServerConfig{NativeInvoiceOnly: true, NativePay: pay, businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, NativeInvoiceDATA: nativeInvoiceDATAFixture(func(context.Context, ShopNativeInvoiceSelectionDATA) (ShopNativeInvoicePriceDATA, error) {
		return publicNativePriceDATA(), nil
	})}
	route := "/api/orders/" + o.ID + "/native-pay-intent"
	body := `{"IdempotencyKey":"PUBLIC-expired-original-lookup"}`
	if w := businessHTTPRequest(NewServer(s, cfg), "POST", route, strings.Repeat("a", 43), body); w.Code < 400 {
		t.Fatal("lost ACK reported success")
	}
	// Controlled deadline fixture: the remote original remains unresolved.
	current := s.s.Orders[o.ID]
	current.ReservationExpiresAt = time.Now().Add(-time.Minute)
	s.s.Orders[o.ID] = current
	if e := s.persistLocked(); e != nil {
		t.Fatal(e)
	}
	stock, _ := json.Marshal(s.s.Products)
	deadline := current.ReservationExpiresAt
	if e := s.Recover(); e != nil {
		t.Fatal(e)
	}
	cfg.NativeInvoiceDATA = nil // Original lookup must not reprice or reread catalog.
	w := businessHTTPRequest(NewServer(s, cfg), "POST", route+"-lookup", strings.Repeat("b", 43), body)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	current = s.s.Orders[o.ID]
	after, _ := json.Marshal(s.s.Products)
	if creates != 1 || lookups != 1 || !strings.HasPrefix(current.PayIntentID, "npi_") || current.InvoiceID == "" || current.Status != "payment_pending" || !current.ReservationExpiresAt.Equal(deadline) || !bytes.Equal(stock, after) || current.NativePayment != nil {
		t.Fatal("original late lookup lost identity, repriced, extended stock or fabricated payment")
	}
	cold, e := Open(s.path)
	if e != nil {
		t.Fatal(e)
	}
	if cold.s.Orders[o.ID].PayIntentID != current.PayIntentID {
		t.Fatal("cold recovery lost original binding")
	}
	if _, e = cold.transition(buyer, "buyer", o.ID, "cancelled", nil, nil, nil, "PUBLIC-after-late-lookup"); e == nil {
		t.Fatal("recovered original locally cancelled")
	}
}

// Preserve old late/cancel/privacy counterexamples as explicit PUBLIC legacy
// snapshots. Normal new cancellation is first proved to refuse without changing
// any durable field. This helper never operates on a real service/account DB.
func nativeLegacyCancelledSnapshotForTest(t *testing.T, s *Store, buyer, orderID, key string) {
	t.Helper()
	s.mu.Lock()
	before, _ := json.Marshal(s.s)
	s.mu.Unlock()
	if _, e := s.transition(buyer, "buyer", orderID, "cancelled", nil, nil, nil, key); e == nil {
		t.Fatal("new bound native cancellation was accepted")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	after, _ := json.Marshal(s.s)
	if !bytes.Equal(before, after) {
		t.Fatal("refused cancellation changed original snapshot")
	}
	o := s.s.Orders[orderID]
	if !s.nativeInvoiceCancellationBlockedLocked(o) || o.Buyer != buyer || o.Status != "payment_pending" {
		t.Fatal("invalid PUBLIC legacy cancellation setup")
	}
	if e := s.applyReservationLocked(o, false); e != nil {
		t.Fatal(e)
	}
	o.Status = "cancelled"
	o.UpdatedAt = s.now()
	s.orderEventLocked(&o, buyer, "buyer", "order_transition", "cancelled", "PUBLIC historical cancellation snapshot; no normal new native cancellation permitted")
	s.s.Orders[orderID] = o
	if e := s.persistLocked(); e != nil {
		t.Fatal(e)
	}
}
