package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// PUBLIC Pay and Source controls. Actual financial authority/independent Core
// proof math is P06's normal product route, verified separately with its fixture.
// No public webhook/flat JSON path can call Store.applyNativePaymentReceipt.
func nativePaymentFixture(t *testing.T) (*Store, string, Order, ServerConfig, *nativeShopArchiveReconciliation, *int) {
	t.Helper()
	s, buyer, o := effectOrderFixture(t, filepath.Join(t.TempDir(), "state.json"))
	gets := new(int)
	price := publicNativePriceDATA()
	price.AmountAtoms = "100"
	cfg := ServerConfig{NativeInvoiceOnly: true, businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, NativeInvoiceDATA: nativeInvoiceDATAFixture(func(context.Context, ShopNativeInvoiceSelectionDATA) (ShopNativeInvoicePriceDATA, error) {
		return price, nil
	})}
	receipt := new(nativeShopArchiveReconciliation)
	client := nativeIntentObservationClient(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v5/pay/invoice-intents" {
			raw, e := io.ReadAll(r.Body)
			if e != nil {
				t.Fatal(e)
			}
			var request NativeShopInvoiceRequestDATA
			if json.Unmarshal(raw, &request) != nil {
				t.Fatal("bad request")
			}
			originalWire := strings.Replace(publicNativeInvoiceResponse(request), `"payer":"`+request.Merchant+`"`, `"payer":"`+buyer+`"`, 1)
			response := strings.TrimSuffix(originalWire, "}") + `,"signingMessageHash":"` + strings.Repeat("c", 64) + `"}`
			return nativeShopPayResponse(200, response), nil
		}
		*gets++
		if r.Method != "GET" || r.URL.Path != "/v5/pay/products/shop.order/"+o.ID+"/invoices/"+price.Merchant+"/core_original/archive-reconciliation" || r.ContentLength != 0 || r.GetBody != nil {
			t.Fatal("receipt read changed into another operation", r.Method, r.URL.Path)
		}
		raw, _ := json.Marshal(receipt)
		return nativeShopPayResponse(200, string(raw)), nil
	})
	cfg.NativePay = client
	w := businessHTTPRequest(NewServer(s, cfg), "POST", "/api/orders/"+o.ID+"/native-pay-intent", strings.Repeat("a", 43), `{"IdempotencyKey":"PUBLIC-native-payment-original"}`)
	if w.Code != 201 && w.Code != 200 {
		t.Fatal("actual original Native creation", w.Code, w.Body.String())
	}
	o = s.s.Orders[o.ID]
	*receipt = nativeShopArchiveReconciliation{Version: "ynx.pay.native.archive-reconciliation/v1", ProductID: "shop.order", StoreID: o.StoreID, SourceOrder: o.ID, Merchant: price.Merchant, InvoiceID: o.InvoiceID, Genesis: price.Genesis, NativeChainID: price.NativeChainID, PrincipalAtoms: "100", PaidAtoms: "100", RefundedAtoms: "0", NetPaidAtoms: "100", Receipts: []nativeShopArchiveReceipt{}, PendingOriginals: []string{}, CompleteKnownOriginals: true, ProofVerification: "original-independent-core-verifier", DataOnly: true, QueryOnly: true}
	receipt.Receipts = append(receipt.Receipts, publicShopReceipt(buyer, *receipt, "invoice_settle", "a", "100", "0", "100", 11))
	return s, buyer, o, cfg, receipt, gets
}
func publicShopReceipt(buyer string, r nativeShopArchiveReconciliation, kind, hash, amount, refunded, net string, height uint64) nativeShopArchiveReceipt {
	refundID := ""
	recipient := "0x" + strings.Repeat("4", 40)
	if kind == "invoice_refund" {
		refundID = "PUBLIC-original-refund-" + hash
		recipient = buyer
	}
	return nativeShopArchiveReceipt{RefundID: refundID, Payer: buyer, Recipient: recipient, AssetID: "YNXT", UnitVersion: "1", ExecutionIndex: "0", ExecutionMember: "0", ExecutionEvent: "0", Version: "ynx.pay.native.archive-receipt/v1", ProductID: r.ProductID, StoreID: r.StoreID, SourceOrder: r.SourceOrder, Merchant: r.Merchant, InvoiceID: r.InvoiceID, SessionID: "core_original_session", Genesis: r.Genesis, NativeChainID: r.NativeChainID, NativeHash: "0x" + strings.Repeat(hash, 64), ABCIHash: "0x" + strings.Repeat(hash, 64), Kind: kind, Status: "confirmed", ArchiveDigest: strings.Repeat(hash, 64), TermsHash: strings.Repeat("c", 64), SettlementNativeHash: "0x" + strings.Repeat("a", 64), EventClaim: strings.Repeat(hash, 64), ExecutionHeight: fmtHeight(height), PrincipalAtoms: amount, PaidAtoms: "100", RefundedAtoms: refunded, NetPaidAtoms: net, ProofVerification: r.ProofVerification, DataOnly: true, QueryOnly: true}
}

func fmtHeight(n uint64) string { return strconv.FormatUint(n, 10) }

func readNativeReceipt(t *testing.T, s *Store, o Order, cfg ServerConfig, nonce string) *httpRecorderForNative {
	t.Helper()
	w := businessHTTPRequest(NewServer(s, cfg), "POST", "/api/orders/"+o.ID+"/confirm-payment", strings.Repeat(nonce, 43), `{}`)
	return &httpRecorderForNative{w.Code, w.Body.String()}
}

type httpRecorderForNative struct {
	code int
	body string
}

func TestNativePaymentReceiptOriginalPartialRefundReturnColdAndDuplicate(t *testing.T) {
	s, buyer, o, cfg, r, gets := nativePaymentFixture(t)
	_, owner := actor(t, 1)
	stock := cloneProduct(s.s.Products[o.Lines[0].ProductID])
	path := s.path
	if w := readNativeReceipt(t, s, o, cfg, "b"); w.code != 200 {
		t.Fatal(w.code, w.body)
	}
	paid := s.s.Orders[o.ID]
	if paid.Status != "paid" || paid.NativePayment == nil || paid.Settlement != nil || paid.NativePayment.PaidAtoms != "100" {
		t.Fatal("receipt not applied independently", paid)
	}
	afterPaid := cloneProduct(s.s.Products[o.Lines[0].ProductID])
	if reflect.DeepEqual(stock, afterPaid) {
		t.Fatal("original reservation not consumed")
	}
	if w := readNativeReceipt(t, s, o, cfg, "c"); w.code != 200 {
		t.Fatal(w.code, w.body)
	}
	if !reflect.DeepEqual(afterPaid, s.s.Products[o.Lines[0].ProductID]) || *gets != 2 {
		t.Fatal("duplicate payment consumed stock")
	}
	var err error
	o, err = s.transition(owner, "seller", o.ID, "shipped", &Shipment{Carrier: "PUBLIC", TrackingNumber: "ORIGINAL"}, nil, nil, "native-original-ship")
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.transition(buyer, "buyer", o.ID, "delivered", nil, nil, nil, "native-original-deliver")
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.transition(buyer, "buyer", o.ID, "return_requested", nil, &Resolution{Kind: "return", Reason: "PUBLIC-return"}, nil, "native-original-return")
	if err != nil {
		t.Fatal(err)
	}
	returnID := o.Timeline[len(o.Timeline)-1].ID
	o, err = s.transition(owner, "seller", o.ID, "return_approved", nil, &Resolution{Kind: "return"}, nil, "native-original-return-approve")
	if err != nil {
		t.Fatal(err)
	}
	r.Receipts = append(r.Receipts, publicShopReceipt(buyer, *r, "invoice_refund", "b", "30", "30", "70", 13))
	r.RefundedAtoms = "30"
	r.NetPaidAtoms = "70"
	if w := readNativeReceipt(t, s, o, cfg, "d"); w.code != 200 {
		t.Fatal(w.code, w.body)
	}
	partial := s.s.Orders[o.ID]
	if partial.Status != "return_approved" || partial.RefundStatus != "native_partial_refund" || partial.NativePayment.NetPaidAtoms != "70" || partial.Refund != nil || !reflect.DeepEqual(afterPaid, s.s.Products[o.Lines[0].ProductID]) {
		t.Fatal("partial refund rewound order or inventory", partial.Status)
	}
	cold, err := Open(path)
	if err != nil {
		t.Fatal("receipt not cold-readable", err)
	}
	if w := readNativeReceipt(t, cold, o, cfg, "e"); w.code != 200 {
		t.Fatal(w.code, w.body)
	}
	if cold.s.Orders[o.ID].NativePayment.NetPaidAtoms != "70" || !reflect.DeepEqual(afterPaid, cold.s.Products[o.Lines[0].ProductID]) {
		t.Fatal("cold duplicate changed financial or stock state")
	}
	// Financial close never implies goods returned. Receive+restock must retain
	// the existing original return ID, warehouse evidence and their own roles.
	in := receiveInput(o, returnID, "PUBLIC-native-goods-receipt", "native-original-receive", 1)
	received, err := cold.ReceiveReturn(owner, o.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(afterPaid, cold.s.Products[o.Lines[0].ProductID]) {
		t.Fatal("goods receipt implicitly restocked")
	}
	restock := RestockReturnInput{ReceiptID: received.ReturnReceipts[0].ID, IdempotencyKey: "native-original-restock"}
	if _, err = cold.RestockReturn(owner, o.ID, restock); err != nil {
		t.Fatal(err)
	}
	afterStock := cloneProduct(cold.s.Products[o.Lines[0].ProductID])
	if _, err = cold.RestockReturn(owner, o.ID, restock); err != nil || !reflect.DeepEqual(afterStock, cold.s.Products[o.Lines[0].ProductID]) {
		t.Fatal("warehouse original repeated", err)
	}
	if cold.s.Orders[o.ID].NativePayment.NetPaidAtoms != "70" {
		t.Fatal("restock changed money")
	}
	if _, err = Open(path); err != nil {
		t.Fatal("whole partial-return flow cold open", err)
	}
}

func TestNativePaymentReceiptLateOrCanceledNeverConsumesReservation(t *testing.T) {
	for _, mode := range []string{"expired", "cancelled"} {
		t.Run(mode, func(t *testing.T) {
			s, buyer, o, cfg, _, _ := nativePaymentFixture(t)
			if mode == "cancelled" {
				if _, e := s.transition(buyer, "buyer", o.ID, "cancelled", nil, nil, nil, "native-original-cancel"); e == nil {
					t.Fatal("bound native invoice was locally cancelled")
				}
				// Retain the historical late-payment counterexample even though
				// normal new transitions now refuse this unsafe cancellation.
				// This is a PUBLIC legacy snapshot fixture, not a live DB edit.
				current := s.s.Orders[o.ID]
				if e := s.applyReservationLocked(current, false); e != nil {
					t.Fatal(e)
				}
				current.Status = "cancelled"
				s.s.Orders[o.ID] = current
			} else {
				current := s.s.Orders[o.ID]
				current.ReservationExpiresAt = time.Now().Add(-time.Second)
				s.s.Orders[o.ID] = current
				if err := s.persistLocked(); err != nil {
					t.Fatal(err)
				}
			}
			stock, _ := json.Marshal(s.s.Products)
			if w := readNativeReceipt(t, s, o, cfg, "b"); w.code != 200 {
				t.Fatal(w.code, w.body)
			}
			got := s.s.Orders[o.ID]
			after, _ := json.Marshal(s.s.Products)
			if got.NativePayment == nil || !got.NativePayment.ReconciliationRequired || got.Status == "paid" || !bytes.Equal(stock, after) {
				t.Fatal("late original silently consumed stock")
			}
			_, owner := actor(t, 1)
			if _, e := s.transition(owner, "seller", o.ID, "shipped", &Shipment{Carrier: "PUBLIC", TrackingNumber: "LATE"}, nil, nil); e == nil {
				t.Fatal("late payment shipped")
			}
		})
	}
}

func TestNativePaymentReceiptInvalidBindingOrHistoryNeverChangesFunds(t *testing.T) {
	for _, mode := range []string{"order", "store", "invoice", "session", "terms", "amount", "unit-network", "duplicate-claim", "over-refund", "flat-authority", "foreign-buyer"} {
		t.Run(mode, func(t *testing.T) {
			s, buyer, o, cfg, r, _ := nativePaymentFixture(t)
			before, _ := json.Marshal(s.s.Products)
			switch mode {
			case "order":
				r.SourceOrder = "other"
			case "store":
				r.StoreID = "other"
			case "invoice":
				r.InvoiceID = "other"
			case "session":
				r.Receipts[0].SessionID = "other"
			case "terms":
				r.Receipts[0].TermsHash = strings.Repeat("d", 64)
			case "amount":
				r.PrincipalAtoms = "101"
			case "unit-network":
				r.NativeChainID = "9"
			case "duplicate-claim":
				r.Receipts = append(r.Receipts, r.Receipts[0])
			case "over-refund":
				r.Receipts = append(r.Receipts, publicShopReceipt(buyer, *r, "invoice_refund", "b", "101", "101", "0", 13))
			case "flat-authority":
				r.SourceAdmission = true
			case "foreign-buyer":
				_, other := actor(t, 9)
				cfg.businessV2 = controlledBusinessVerifier{account: other, role: "buyer"}
			}
			if w := readNativeReceipt(t, s, o, cfg, "b"); w.code < 400 {
				t.Fatal("invalid receipt applied", mode, w.body)
			}
			after, _ := json.Marshal(s.s.Products)
			if s.s.Orders[o.ID].NativePayment != nil || s.s.Orders[o.ID].Status != "payment_pending" || !bytes.Equal(before, after) {
				t.Fatal("refused receipt changed funds/stock")
			}
		})
	}
}

func TestNativePaymentReceiptLostReadColdLookupAndRollback(t *testing.T) {
	s, buyer, o, cfg, r, gets := nativePaymentFixture(t)
	original := cfg.NativePay.client.Transport
	lost := true
	cfg.NativePay.client.Transport = nativeShopPayTransport(func(req *http.Request) (*http.Response, error) {
		if lost {
			return nil, errors.New("PUBLIC original receipt read lost")
		}
		return original.RoundTrip(req)
	})
	if w := readNativeReceipt(t, s, o, cfg, "b"); w.code < 400 {
		t.Fatal("lost response accepted")
	}
	if s.s.Orders[o.ID].NativePayment != nil {
		t.Fatal("unknown read marked paid")
	}
	cold, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	lost = false
	if w := readNativeReceipt(t, cold, o, cfg, "c"); w.code != 200 {
		t.Fatal(w.code, w.body)
	}
	if *gets != 1 || cold.s.Orders[o.ID].NativePayment.PaidAtoms != "100" {
		t.Fatal("cold read recreated original or failed")
	}
	// Accepted history cannot be replaced with an older cumulative projection.
	r.Receipts = append(r.Receipts, publicShopReceipt(buyer, *r, "invoice_refund", "b", "30", "30", "70", 13))
	r.RefundedAtoms = "30"
	r.NetPaidAtoms = "70"
	if w := readNativeReceipt(t, cold, o, cfg, "d"); w.code != 200 {
		t.Fatal(w.code, w.body)
	}
	r.Receipts = r.Receipts[:1]
	r.RefundedAtoms = "0"
	r.NetPaidAtoms = "100"
	if w := readNativeReceipt(t, cold, o, cfg, "e"); w.code < 400 {
		t.Fatal("old history rolled back refund")
	}
	if cold.s.Orders[o.ID].NativePayment.NetPaidAtoms != "70" {
		t.Fatal("accepted partial refund erased")
	}
	// Keep exact data/rollback protection; corrupt imported payment projection
	// cannot acquire authority merely by claiming a JSON receipt was verified.
	raw, err := os.ReadFile(s.path)
	if err != nil {
		t.Fatal(err)
	}
	var snap Snapshot
	if json.Unmarshal(raw, &snap) != nil {
		t.Fatal("fixture unsigned snapshot")
	}
	changed := snap.Orders[o.ID]
	p := *changed.NativePayment
	p.PaidAtoms = "999"
	changed.NativePayment = &p
	snap.Orders[o.ID] = changed
	tampered, _ := json.Marshal(snap)
	bad := filepath.Join(t.TempDir(), "bad.json")
	os.WriteFile(bad, tampered, 0600)
	if _, err = Open(bad); err == nil {
		t.Fatal("unbacked cold payment projection accepted")
	}
}

func TestNativePaymentReceiptCoordinatesPartiesAndRefundIDs(t *testing.T) {
	for _, mode := range []string{"same-block-valid", "coordinate-duplicate", "coordinate-reversed", "payer", "recipient", "asset", "unit", "refund-empty", "refund-repeated", "duplicate-json"} {
		t.Run(mode, func(t *testing.T) {
			s, buyer, o, cfg, r, _ := nativePaymentFixture(t)
			first := publicShopReceipt(buyer, *r, "invoice_refund", "b", "30", "30", "70", 11)
			first.ExecutionIndex = "1"
			second := publicShopReceipt(buyer, *r, "invoice_refund", "d", "20", "50", "50", 11)
			second.ExecutionIndex = "2"
			r.Receipts = append(r.Receipts, first, second)
			r.RefundedAtoms = "50"
			r.NetPaidAtoms = "50"
			switch mode {
			case "coordinate-duplicate":
				r.Receipts[2].ExecutionIndex = "1"
			case "coordinate-reversed":
				r.Receipts[1], r.Receipts[2] = r.Receipts[2], r.Receipts[1]
			case "payer":
				r.Receipts[1].Payer = "0x" + strings.Repeat("f", 40)
			case "recipient":
				r.Receipts[1].Recipient = "0x" + strings.Repeat("4", 40)
			case "asset":
				r.Receipts[1].AssetID = "other"
			case "unit":
				r.Receipts[1].UnitVersion = "2"
			case "refund-empty":
				r.Receipts[1].RefundID = ""
			case "refund-repeated":
				r.Receipts[2].RefundID = r.Receipts[1].RefundID
			case "duplicate-json":
				original := cfg.NativePay.client.Transport
				cfg.NativePay.client.Transport = nativeShopPayTransport(func(req *http.Request) (*http.Response, error) {
					out, e := original.RoundTrip(req)
					if e != nil {
						return out, e
					}
					raw, _ := io.ReadAll(out.Body)
					out.Body.Close()
					raw = append(raw[:len(raw)-1], []byte(`,"paidAtoms":"100"}`)...)
					return nativeShopPayResponse(200, string(raw)), nil
				})
			}
			w := readNativeReceipt(t, s, o, cfg, "b")
			if mode == "same-block-valid" {
				if w.code != 200 || s.s.Orders[o.ID].NativePayment.NetPaidAtoms != "50" {
					t.Fatal("same block original coordinate ordering failed", w.code, w.body)
				}
			} else if w.code < 400 || s.s.Orders[o.ID].NativePayment != nil {
				t.Fatal("invalid original parties/refund/coordinate applied", mode, w.code)
			}
		})
	}
}

func TestNativePaymentReceiptRevokedAfterResponseRetainsObservationNotFunds(t *testing.T) {
	s, buyer, o, cfg, _, _ := nativePaymentFixture(t)
	var revoked atomic.Bool
	cfg.businessV2 = controlledBusinessVerifier{account: buyer, role: "buyer", fence: func() error {
		if revoked.Load() {
			return ErrUnauthorized
		}
		return nil
	}}
	original := cfg.NativePay.client.Transport
	cfg.NativePay.client.Transport = nativeShopPayTransport(func(r *http.Request) (*http.Response, error) {
		response, e := original.RoundTrip(r)
		revoked.Store(true)
		return response, e
	})
	if w := readNativeReceipt(t, s, o, cfg, "b"); w.code < 400 {
		t.Fatal("late revoked response emitted")
	}
	if s.s.Orders[o.ID].NativePayment != nil || s.s.Orders[o.ID].Status != "payment_pending" {
		t.Fatal("late current changed funds")
	}
	observed := false
	for _, r := range s.s.BusinessEffects {
		if r.Kind == "pay.native-receipt" {
			observed = r.Phase == "observed" && json.Valid(r.Result)
		}
	}
	if !observed {
		t.Fatal("exact late response/firstcause observation lost")
	}
	if _, e := Open(s.path); e != nil {
		t.Fatal("late observation not cold retained", e)
	}
}

func TestNativePaymentReceiptMissingOriginalArchiveKeeps409(t *testing.T) {
	s, _, o, cfg, _, _ := nativePaymentFixture(t)
	cfg.NativePay.client.Transport = nativeShopPayTransport(func(r *http.Request) (*http.Response, error) {
		if r.Method != "GET" {
			t.Fatal("missing original caused POST")
		}
		return nativeShopPayResponse(409, `{"code":"NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE"}`), nil
	})
	w := readNativeReceipt(t, s, o, cfg, "b")
	if w.code != 409 || !strings.Contains(w.body, "NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE") || s.s.Orders[o.ID].NativePayment != nil {
		t.Fatal("old missing history replaced or status changed", w.code, w.body)
	}
}

func TestNativePaymentReceiptKeepsPendingOriginalsAcrossColdAndNoReplay(t *testing.T) {
	s, _, o, cfg, r, _ := nativePaymentFixture(t)
	pending := "0x" + strings.Repeat("d", 64)
	r.PendingOriginals = []string{pending}
	r.CompleteKnownOriginals = false
	if w := readNativeReceipt(t, s, o, cfg, "b"); w.code != 200 {
		t.Fatal(w.code, w.body)
	}
	cold, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := cold.Order(o.Buyer, "buyer", o.ID)
	if got.NativePayment.CompleteKnownOriginals || len(got.NativePayment.PendingOriginals) != 1 || got.NativePayment.PendingOriginals[0] != pending || got.NativePayment.PaidAtoms != "100" {
		t.Fatal("pending original disappeared or rewound confirmed paid")
	}
	got.NativePayment.PendingOriginals[0] = "mutated-response"
	if cold.s.Orders[o.ID].NativePayment.PendingOriginals[0] != pending {
		t.Fatal("caller mutated retained pending original")
	}
	r.PendingOriginals = nil
	r.CompleteKnownOriginals = true
	if w := readNativeReceipt(t, cold, o, cfg, "c"); w.code < 400 {
		t.Fatal("pending original was silently removed")
	}
	if cold.s.Orders[o.ID].NativePayment.PendingOriginals[0] != pending {
		t.Fatal("unknown receipt lost")
	}
	// A canonical failed receipt resolves only the same original reference; it
	// neither creates a refund amount nor changes an accepted payment.
	failed := r.Receipts[0]
	failed.NativeHash = pending
	failed.ABCIHash = pending
	failed.Kind = "invoice_refund"
	failed.Status = "confirmed_failed"
	failed.ExecutionHeight = "13"
	failed.PrincipalAtoms = "0"
	failed.PaidAtoms = "0"
	failed.RefundedAtoms = "0"
	failed.NetPaidAtoms = "0"
	failed.Payer = ""
	failed.Recipient = ""
	failed.EventClaim = ""
	failed.RefundID = ""
	failed.SettlementNativeHash = ""
	r.Receipts = append(r.Receipts, failed)
	if w := readNativeReceipt(t, cold, o, cfg, "d"); w.code != 200 {
		t.Fatal(w.code, w.body)
	}
	payment := cold.s.Orders[o.ID].NativePayment
	if !payment.CompleteKnownOriginals || len(payment.PendingOriginals) != 0 || payment.PaidAtoms != "100" || payment.RefundedAtoms != "0" {
		t.Fatal("resolved failed original changed money")
	}
}

func TestNativePaymentReceiptCanonicalColonReferenceActualHTTP(t *testing.T) {
	calls := 0
	merchant := "0x" + strings.Repeat("a", 40)
	endpoint := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "GET" || r.RequestURI != "/v5/pay/products/shop.order/order%3A100/invoices/"+merchant+"/invoice%3A100/archive-reconciliation" {
			t.Error("original identifier lost canonical archive spelling", r.Method, r.RequestURI)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"PUBLIC":"canonical exact original transport only"}`))
	}))
	defer endpoint.Close()
	client, err := NewOriginalNativeShopPayClient(endpoint.URL, endpoint.Client())
	if err != nil {
		t.Fatal(err)
	}
	path, err := nativeShopProductReceiptPath("order:100", merchant, "invoice:100")
	if err != nil {
		t.Fatal(err)
	}
	if out, err := client.exchange(t.Context(), "GET", path, nil, false); err != nil || out.Status != 200 || calls != 1 {
		t.Fatal("actual canonical original read", err, out.Status, calls)
	}
	for _, invalid := range []string{"order%3A100", "order/100", "order?100"} {
		if _, err := nativeShopProductReceiptPath(invalid, merchant, "invoice:100"); err == nil {
			t.Fatal("preescaped/foreign selector accepted", invalid)
		}
	}
}

// New cumulative refund delta: full financial close never receives/restocks goods.
func TestNativePaymentReceiptCumulativeRefundColdNoAutomaticRestock(t *testing.T) {
	s, buyer, o, cfg, r, _ := nativePaymentFixture(t)
	_, owner := actor(t, 1)
	if w := readNativeReceipt(t, s, o, cfg, "b"); w.code != 200 {
		t.Fatal(w.code, w.body)
	}
	afterPaid := cloneProduct(s.s.Products[o.Lines[0].ProductID])
	var err error
	for _, step := range []struct{ actor, role, status, key string }{
		{owner, "seller", "shipped", "multi-ship"}, {buyer, "buyer", "delivered", "multi-deliver"}, {buyer, "buyer", "return_requested", "multi-return"}, {owner, "seller", "return_approved", "multi-approve"},
	} {
		var shipment *Shipment
		var resolution *Resolution
		if step.status == "shipped" {
			shipment = &Shipment{Carrier: "PUBLIC", TrackingNumber: "MULTI"}
		}
		if step.status == "return_requested" || step.status == "return_approved" {
			resolution = &Resolution{Kind: "return", Reason: "PUBLIC-original"}
		}
		o, err = s.transition(step.actor, step.role, o.ID, step.status, shipment, resolution, nil, step.key)
		if err != nil {
			t.Fatal(err)
		}
	}
	returnID := o.Timeline[len(o.Timeline)-2].ID
	for i, stage := range []struct {
		hash, amount, refunded, net, index string
		height                             uint64
	}{
		{"b", "30", "30", "70", "0", 13}, {"d", "20", "50", "50", "1", 13}, {"e", "50", "100", "0", "0", 14},
	} {
		receipt := publicShopReceipt(buyer, *r, "invoice_refund", stage.hash, stage.amount, stage.refunded, stage.net, stage.height)
		receipt.ExecutionIndex = stage.index
		r.Receipts = append(r.Receipts, receipt)
		r.RefundedAtoms = stage.refunded
		r.NetPaidAtoms = stage.net
		if w := readNativeReceipt(t, s, o, cfg, string(rune('c'+i*2))); w.code != 200 {
			t.Fatal(i, w.code, w.body)
		}
		got := s.s.Orders[o.ID]
		if got.NativePayment.RefundedAtoms != stage.refunded || got.NativePayment.NetPaidAtoms != stage.net || len(got.ReturnReceipts) != 0 || !reflect.DeepEqual(afterPaid, s.s.Products[o.Lines[0].ProductID]) {
			t.Fatal("refund implicitly received/restocked goods", i)
		}
		expectedStatus, expectedRefund := "return_approved", "native_partial_refund"
		if i == 2 {
			expectedStatus, expectedRefund = "refunded", "native_refunded"
		}
		if got.Status != expectedStatus || got.RefundStatus != expectedRefund {
			t.Fatal("wrong cumulative financial state", i, got.Status)
		}
		original := *got.NativePayment
		s, err = Open(s.path)
		if err != nil {
			t.Fatal(err)
		}
		if w := readNativeReceipt(t, s, o, cfg, string(rune('d'+i*2))); w.code != 200 {
			t.Fatal(i, w.code, w.body)
		}
		if !reflect.DeepEqual(original, *s.s.Orders[o.ID].NativePayment) || !reflect.DeepEqual(afterPaid, s.s.Products[o.Lines[0].ProductID]) {
			t.Fatal("cold duplicate changed original claims/stock", i)
		}
	}
	received, err := s.ReceiveReturn(owner, o.ID, receiveInput(o, returnID, "PUBLIC-multi-goods", "multi-receive", 1))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(afterPaid, s.s.Products[o.Lines[0].ProductID]) {
		t.Fatal("goods receipt implicitly restocked")
	}
	restock := RestockReturnInput{ReceiptID: received.ReturnReceipts[0].ID, IdempotencyKey: "multi-restock"}
	if _, err = s.RestockReturn(owner, o.ID, restock); err != nil {
		t.Fatal(err)
	}
	afterRestock := cloneProduct(s.s.Products[o.Lines[0].ProductID])
	s, err = Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.RestockReturn(owner, o.ID, restock); err != nil || !reflect.DeepEqual(afterRestock, s.s.Products[o.Lines[0].ProductID]) {
		t.Fatal("cold restock duplicated", err)
	}
}
