package commerce

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
)

func transitionDomainSnapshot(t *testing.T, s *Store) []byte {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	copy, err := cloneSnapshot(s.s)
	if err != nil {
		t.Fatal(err)
	}
	// The original HTTP security middleware counts rejected requests too.
	// Compare every business field while excluding only that rate-limit window.
	copy.RequestWindow = nil
	raw, err := json.Marshal(copy)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestBusinessTransitionsKeepOriginalFulfillmentAndReviewFlow(t *testing.T) {
	s, buyer, order, evidence := settlementFixture(t)
	_, owner := actor(t, 1)
	if _, err := s.ConfirmSettlement(order.ID, evidence); err != nil {
		t.Fatal(err)
	}
	route := "/api/orders/" + order.ID + "/transition"
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}})
	body := `{"Action":"shipped","Carrier":"Carrier","TrackingNumber":"TRACK","IdempotencyKey":"v2-owner-shipment"}`
	w := businessHTTPRequest(server, "POST", route, strings.Repeat("b", 43), body)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := businessHTTPRequest(server, "POST", route, strings.Repeat("b", 43), body); w.Code != 409 {
		t.Fatal("action replay accepted")
	}
	if w := businessHTTPRequest(server, "POST", route, strings.Repeat("c", 43), body); w.Code != 200 {
		t.Fatal("original intent recovery failed", w.Code)
	}
	server = NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}})
	if w := businessHTTPRequest(server, "POST", route, strings.Repeat("d", 43), `{"Action":"delivered","IdempotencyKey":"v2-buyer-delivery"}`); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := businessHTTPRequest(server, "POST", route, strings.Repeat("e", 43), `{"Action":"reviewed","Rating":4,"Body":"actual review","IdempotencyKey":"v2-buyer-review"}`); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	r, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := r.Order(buyer, "buyer", order.ID)
	if got.Status != "reviewed" || got.Review == nil || got.Review.Body != "actual review" || got.Shipment == nil || got.Shipment.TrackingNumber != "TRACK" {
		t.Fatal("original fulfillment state lost")
	}
}

func TestBusinessTransitionPermissionsAndWalletSensitiveBoundary(t *testing.T) {
	s, buyer, order, evidence := settlementFixture(t)
	_, owner := actor(t, 1)
	_, foreign := actor(t, 3)
	if _, err := s.ConfirmSettlement(order.ID, evidence); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer provider.Close()
	cfg := ServerConfig{Pay: HTTPPayVerifier{BaseURL: provider.URL, APIKey: "qa", MerchantID: order.PayMerchant, PayoutAddress: order.PayPayoutAddress}}
	route := "/api/orders/" + order.ID + "/transition"
	for _, who := range []struct{ account, role string }{{buyer, "buyer"}, {foreign, "seller"}} {
		cfg.businessV2 = controlledBusinessVerifier{account: who.account, role: who.role}
		w := businessHTTPRequest(NewServer(s, cfg), "POST", route, strings.Repeat("b", 43), `{"Action":"shipped","Carrier":"C","TrackingNumber":"T","IdempotencyKey":"forbidden-shipment"}`)
		if w.Code != 409 || len(s.s.BusinessNonces) != 0 {
			t.Fatal("role created foreign authority", w.Code)
		}
	}
	cfg.businessV2 = controlledBusinessVerifier{account: buyer, role: "buyer"}
	if w := businessHTTPRequest(NewServer(s, cfg), "POST", route, strings.Repeat("b", 43), `{"Action":"refund_requested","Reason":"Damaged","IdempotencyKey":"v2-buyer-refund-request"}`); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	before := transitionDomainSnapshot(t, s)
	cfg.businessV2 = controlledBusinessVerifier{account: owner, role: "seller"}
	w := businessHTTPRequest(NewServer(s, cfg), "POST", route, strings.Repeat("c", 43), `{"Action":"refund_approved","IdempotencyKey":"v2-refund-sensitive"}`)
	after := transitionDomainSnapshot(t, s)
	if w.Code != 409 || !strings.Contains(w.Body.String(), "WALLET_SENSITIVE_APPROVAL_REQUIRED") || calls.Load() != 0 || !bytes.Equal(before, after) {
		t.Fatal("broad product approval executed refund", w.Code)
	}
}

func TestBusinessCancelFailureAndActorFencePreserveInventoryAndNonce(t *testing.T) {
	for _, fault := range []string{"disk", "actor"} {
		t.Run(fault, func(t *testing.T) {
			s, buyer, order, _ := settlementFixture(t)
			body := `{"Action":"cancelled","IdempotencyKey":"v2-safe-cancel-key"}`
			route := "/api/orders/" + order.ID + "/transition"
			var checks int
			cfg := ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}}
			if fault == "disk" {
				if err := os.Mkdir(s.path+".tmp", 0700); err != nil {
					t.Fatal(err)
				}
			} else {
				cfg.businessV2 = controlledBusinessVerifier{account: buyer, role: "buyer", fence: func() error {
					checks++
					if checks >= 4 {
						return ErrUnauthorized
					}
					return nil
				}}
			}
			before := transitionDomainSnapshot(t, s)
			w := businessHTTPRequest(NewServer(s, cfg), "POST", route, strings.Repeat("b", 43), body)
			after := transitionDomainSnapshot(t, s)
			if w.Code < 400 || !bytes.Equal(before, after) {
				var left, right map[string]json.RawMessage
				_ = json.Unmarshal(before, &left)
				_ = json.Unmarshal(after, &right)
				for key, value := range left {
					if !bytes.Equal(value, right[key]) {
						t.Log("changed snapshot field", key)
					}
				}
				t.Fatal("failed cancel changed inventory or nonce", w.Code)
			}
			if fault == "disk" {
				if err := os.Remove(s.path + ".tmp"); err != nil {
					t.Fatal(err)
				}
			}
			cfg.businessV2 = controlledBusinessVerifier{account: buyer, role: "buyer"}
			w = businessHTTPRequest(NewServer(s, cfg), "POST", route, strings.Repeat("b", 43), body)
			if w.Code != 200 {
				t.Fatal("failed cancel could not be retried", w.Code, w.Body.String())
			}
			product := s.s.Products[order.Lines[0].ProductID]
			if product.Variants[0].Reserved != 0 || product.Variants[0].Inventory != 5 {
				t.Fatal("cancel lost original inventory")
			}
		})
	}
}
