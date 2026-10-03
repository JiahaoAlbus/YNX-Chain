package commerce

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestBusinessSettlementAmountRepresentationsPresenceTypeAndRange(t *testing.T) {
	for _, test := range []struct {
		name  string
		valid bool
	}{
		{"current only", true}, {"legacy only", true}, {"both consistent", true},
		{"different", false}, {"current explicit zero", false}, {"legacy explicit zero", false},
		{"current null", false}, {"legacy null", false}, {"string", false}, {"fraction", false}, {"overflow", false}, {"negative", false}, {"boolean", false}, {"both missing", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			s, buyer, order, receipt := settlementFixture(t)
			var calls atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" {
					t.Error("settlement executed mutation")
				}
				calls.Add(1)
				raw, _ := json.Marshal(receipt)
				var fields map[string]json.RawMessage
				_ = json.Unmarshal(raw, &fields)
				fields["Amount"], _ = json.Marshal(receipt.AmountYNXT)
				switch test.name {
				case "current only":
					delete(fields, "Amount")
				case "legacy only":
					delete(fields, "AmountYNXT")
				case "different":
					fields["Amount"], _ = json.Marshal(receipt.AmountYNXT + 1)
				case "current explicit zero":
					fields["AmountYNXT"] = json.RawMessage("0")
				case "legacy explicit zero":
					fields["Amount"] = json.RawMessage("0")
				case "current null":
					fields["AmountYNXT"] = json.RawMessage("null")
				case "legacy null":
					fields["Amount"] = json.RawMessage("null")
				case "string":
					fields["Amount"] = json.RawMessage(`"8"`)
				case "fraction":
					fields["Amount"] = json.RawMessage("8.5")
				case "overflow":
					fields["Amount"] = json.RawMessage("9223372036854775808")
				case "negative":
					fields["Amount"] = json.RawMessage("-1")
				case "boolean":
					fields["Amount"] = json.RawMessage("true")
				case "both missing":
					delete(fields, "Amount")
					delete(fields, "AmountYNXT")
				}
				json.NewEncoder(w).Encode(fields)
			}))
			defer provider.Close()
			server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, Pay: HTTPPayVerifier{BaseURL: provider.URL, APIKey: "qa"}})
			w := businessHTTPRequest(server, "POST", "/api/orders/"+order.ID+"/confirm-payment", strings.Repeat("b", 43), `{}`)
			got, _ := s.Order(buyer, "buyer", order.ID)
			if calls.Load() != 1 {
				t.Fatal("query count changed")
			}
			if test.valid {
				if w.Code != 200 || got.Status != "paid" || got.Settlement == nil || got.Settlement.AmountYNXT != receipt.AmountYNXT || got.Settlement.Payer != receipt.Payer {
					t.Fatal("compatible exact receipt rejected or rewritten", w.Code, w.Body.String())
				}
			}
			if !test.valid {
				if w.Code < 400 || got.Status != "payment_pending" || got.Settlement != nil {
					t.Fatal("contradictory or invalid amount finalized", w.Code)
				}
			}
			for _, effect := range s.s.BusinessEffects {
				if len(effect.Steps) != 1 || effect.Steps[0].Phase != "received" {
					t.Fatal("original raw response lost")
				}
				var original map[string]json.RawMessage
				if json.Unmarshal(effect.Steps[0].Response, &original) != nil {
					t.Fatal("raw JSON receipt missing")
				}
				if test.name == "legacy explicit zero" && string(original["Amount"]) != "0" {
					t.Fatal("raw zero rewritten")
				}
			}
		})
	}
}

func TestPaySettlementSingleAmountZeroAndMaximumCompatibility(t *testing.T) {
	for _, field := range []string{"Amount", "AmountYNXT"} {
		for _, amount := range []int64{0, math.MaxInt64} {
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { json.NewEncoder(w).Encode(map[string]any{field: amount}) }))
			receipt, err := (HTTPPayVerifier{BaseURL: provider.URL, APIKey: "qa"}).Settlement(context.Background(), "compatibility-invoice")
			provider.Close()
			if err != nil || receipt.AmountYNXT != amount {
				t.Fatal("single-representation int64 boundary changed", field, amount, err)
			}
		}
	}
}
