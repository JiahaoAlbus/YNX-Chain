package commerce

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func nativeIntentOrderFixture(t *testing.T) (*Store, string, Order) {
	t.Helper()
	s, buyer, order := effectOrderFixture(t, filepath.Join(t.TempDir(), "state.json"))
	order, err := s.BindInvoice(buyer, order.ID, PayInvoiceHandoff{InvoiceID: "original_invoice",
		IntentID: "npi_" + strings.Repeat("ab", 24), Merchant: "original_merchant", PayoutAddress: buyer})
	if err != nil {
		t.Fatal(err)
	}
	return s, buyer, order
}

func nativeIntentObservationWire(order Order) map[string]any {
	return map[string]any{"intentId": order.PayIntentID, "originalOperation": order.PayIntentID,
		"state": "PREPARED", "phase": "signed_not_submitted", "merchant": order.PayMerchant,
		"request": map[string]any{"productId": "shop.order", "storeId": order.StoreID, "sourceOrder": order.ID,
			"merchant": order.PayMerchant, "recipient": order.PayPayoutAddress, "domainData": map[string]any{"private": "not-for-client"}},
		"terms":   map[string]any{"invoiceId": order.InvoiceID, "recipient": order.PayPayoutAddress},
		"invoice": map[string]any{"status": "paid", "amount": "not-a-funds-proof"}}
}

func nativeIntentObservationClient(t *testing.T, transport nativeShopPayTransport) *NativeShopPayClient {
	t.Helper()
	client, err := NewOriginalNativeShopPayClient("https://pay.invalid", &http.Client{Transport: transport})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func TestBusinessNativeIntentColdRecoveryUsesOriginalOrderAndNeverSettles(t *testing.T) {
	s, buyer, order := nativeIntentOrderFixture(t)
	before, err := cloneSnapshot(s.s)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	wire, _ := json.Marshal(nativeIntentObservationWire(order))
	client := nativeIntentObservationClient(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != "GET" || r.URL.Path != "/v5/pay/invoice-intents/"+order.PayIntentID || r.ContentLength != 0 || r.GetBody != nil {
			t.Fatal("original recovery changed into mutation", r.Method, r.URL.Path)
		}
		return nativeShopPayResponse(200, string(wire)), nil
	})
	cfg := ServerConfig{NativePay: client, businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}}
	path := "/api/orders/" + order.ID + "/native-pay-intent"
	w := businessHTTPRequest(NewServer(s, cfg), "GET", path, strings.Repeat("a", 43), "")
	if w.Code != 200 || calls != 1 {
		t.Fatal(w.Code, w.Body.String(), calls)
	}
	var observation NativeShopIntentObservation
	if json.Unmarshal(w.Body.Bytes(), &observation) != nil || !observation.QueryOnly || observation.FundsVerified || observation.OriginalOperation != order.PayIntentID || observation.State != "PREPARED" {
		t.Fatal("invalid query-only result", w.Body.String())
	}
	if bytes.Contains(w.Body.Bytes(), []byte("not-for-client")) || bytes.Contains(w.Body.Bytes(), []byte("not-a-funds-proof")) {
		t.Fatal("private Pay body exposed")
	}
	if !reflect.DeepEqual(before.Orders, s.s.Orders) || !reflect.DeepEqual(before.Products, s.s.Products) || !reflect.DeepEqual(before.Audits, s.s.Audits) {
		t.Fatal("read changed order/stock/audit")
	}
	for _, record := range s.s.BusinessEffects {
		if record.Kind != "pay.native-intent" || record.Phase != "completed" || len(record.Steps) != 1 || !bytes.Equal(record.Result, wire) || !bytes.Equal(record.Steps[0].Response, wire) {
			t.Fatal("original wire receipt not retained", record)
		}
	}
	reopened, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	if w := businessHTTPRequest(NewServer(reopened, cfg), "GET", path, strings.Repeat("a", 43), ""); w.Code != 409 || calls != 1 {
		t.Fatal("old action replayed", w.Code, calls)
	}
	// Recovery after cancellation still uses the retained operation and does not
	// restore an expired reservation or construct a current-price invoice.
	if _, err := reopened.transition(buyer, "buyer", order.ID, "cancelled", nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	w = businessHTTPRequest(NewServer(reopened, cfg), "GET", path, strings.Repeat("b", 43), "")
	if w.Code != 200 || calls != 2 || reopened.s.Orders[order.ID].Status != "cancelled" || reopened.s.Orders[order.ID].Settlement != nil {
		t.Fatal(w.Code, w.Body.String(), calls)
	}
}

func TestBusinessNativeIntentUnknownCanOnlyRepeatOriginalReadWithFreshAction(t *testing.T) {
	s, buyer, order := nativeIntentOrderFixture(t)
	calls := 0
	client := nativeIntentObservationClient(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			return nil, errors.New("PUBLIC lost original response")
		}
		wire, _ := json.Marshal(nativeIntentObservationWire(order))
		return nativeShopPayResponse(200, string(wire)), nil
	})
	cfg := ServerConfig{NativePay: client, businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}}
	path := "/api/orders/" + order.ID + "/native-pay-intent"
	if w := businessHTTPRequest(NewServer(s, cfg), "GET", path, strings.Repeat("c", 43), ""); w.Code < 400 {
		t.Fatal(w.Code)
	}
	reopened, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	if w := businessHTTPRequest(NewServer(reopened, cfg), "GET", path, strings.Repeat("d", 43), ""); w.Code != 200 || calls != 2 {
		t.Fatal(w.Code, w.Body.String(), calls)
	}
	if len(reopened.s.BusinessEffects) != 2 || reopened.s.Orders[order.ID].Settlement != nil {
		t.Fatal("unknown original discarded or paid fabricated")
	}
}

func TestBusinessNativeIntentRefusesForeignAndReboundOriginal(t *testing.T) {
	for _, field := range []string{"intentId", "originalOperation", "state", "phase", "merchant", "productId", "storeId", "sourceOrder", "recipient", "invoiceId"} {
		t.Run(field, func(t *testing.T) {
			s, buyer, order := nativeIntentOrderFixture(t)
			view := nativeIntentObservationWire(order)
			switch field {
			case "phase":
				view[field] = "invalid/phase"
			case "productId", "storeId", "sourceOrder", "recipient":
				view["request"].(map[string]any)[field] = "foreign"
			case "invoiceId":
				view["terms"].(map[string]any)[field] = "foreign"
			default:
				view[field] = "foreign"
			}
			wire, _ := json.Marshal(view)
			client := nativeIntentObservationClient(t, func(*http.Request) (*http.Response, error) { return nativeShopPayResponse(200, string(wire)), nil })
			server := NewServer(s, ServerConfig{NativePay: client, businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}})
			w := businessHTTPRequest(server, "GET", "/api/orders/"+order.ID+"/native-pay-intent", strings.Repeat("e", 43), "")
			if w.Code < 400 || bytes.Contains(w.Body.Bytes(), []byte("queryOnly")) || s.s.Orders[order.ID].Settlement != nil {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
	for _, mode := range []string{"foreign", "no-client", "zero-client", "legacy", "late-revoked"} {
		t.Run(mode, func(t *testing.T) {
			s, buyer, order := nativeIntentOrderFixture(t)
			calls := 0
			revoked := false
			client := nativeIntentObservationClient(t, func(*http.Request) (*http.Response, error) {
				calls++
				revoked = true
				wire, _ := json.Marshal(nativeIntentObservationWire(order))
				return nativeShopPayResponse(200, string(wire)), nil
			})
			cfg := ServerConfig{NativePay: client, businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}}
			switch mode {
			case "foreign":
				cfg.businessV2 = controlledBusinessVerifier{account: order.PayMerchant, role: "buyer"}
			case "no-client":
				cfg.NativePay = nil
			case "zero-client":
				cfg.NativePay = &NativeShopPayClient{}
			case "legacy":
				cfg.businessV2 = nil
			case "late-revoked":
				cfg.businessV2 = controlledBusinessVerifier{account: buyer, role: "buyer", fence: func() error {
					if revoked {
						return ErrUnauthorized
					}
					return nil
				}}
			}
			w := businessHTTPRequest(NewServer(s, cfg), "GET", "/api/orders/"+order.ID+"/native-pay-intent", strings.Repeat("f", 43), "")
			if w.Code < 400 || bytes.Contains(w.Body.Bytes(), []byte("queryOnly")) || mode != "late-revoked" && calls != 0 {
				t.Fatal(mode, w.Code, w.Body.String(), calls)
			}
			if mode == "late-revoked" {
				for _, record := range s.s.BusinessEffects {
					if len(record.Result) == 0 || len(record.Steps) != 1 {
						t.Fatal("late denial lost durable original")
					}
				}
			}
		})
	}
}
