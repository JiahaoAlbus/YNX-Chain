package quantlab

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/exchangeproduct"
)

func TestHTTPExchangeAdapterUsesCanonicalMandateAndSeparateOrderSignature(t *testing.T) {
	now := time.Date(2026, 8, 10, 1, 2, 3, 0, time.UTC)
	strategy := strings.Repeat("a", 64)
	mandate := Mandate{
		Account: "ynx1quant", StrategyHash: strategy, Market: exchangeproduct.DefaultMarket,
		Methods: []string{"submit", "read"}, CapitalMicro: 2_000_000, Leverage: 1,
		NonceDomain: "quant:" + strategy, ExpiresAt: now.Add(time.Hour), WalletSignature: "mandate-signature",
	}
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Header.Get("Authorization") != "Bearer central-wallet-session" || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("missing authenticated JSON boundary: %#v", r.Header)
		}
		var envelope struct {
			Mandate exchangeproduct.QuantMandate      `json:"mandate"`
			Order   exchangeproduct.PlaceOrderRequest `json:"order"`
		}
		if err := json.NewDecoder(r.Body).Decode(&envelope); err != nil {
			t.Fatal(err)
		}
		if string(exchangeproduct.QuantMandatePayload(envelope.Mandate)) != string(exchangeproduct.QuantMandatePayload(exchangeMandate(mandate))) {
			t.Fatalf("canonical mandate changed: %#v", envelope.Mandate)
		}
		switch r.URL.Path {
		case "/v1/quant-adapter/account":
			_ = json.NewEncoder(w).Encode(exchangeproduct.QuantAccountState{Source: exchangeproduct.QuantSource{Version: exchangeproduct.QuantAdapterVersion, Status: "available"}})
		case "/v1/quant-adapter/orders":
			if envelope.Order.WalletSignature != "independent-order-signature" || envelope.Order.Type != "limit" || envelope.Order.TimeInForce != "gtc" {
				t.Fatalf("order authorization lost: %#v", envelope.Order)
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(exchangeproduct.Order{ID: "order-1", Account: mandate.Account, QuantNonceDomain: mandate.NonceDomain, Market: mandate.Market, Side: "buy", PriceMicro: 1_000_000, AmountMicro: 1_000_000, Status: "open", WalletAuthorized: true, AuthorizationDigest: strings.Repeat("b", 64)})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	adapter := HTTPExchangeAdapter{BaseURL: server.URL, Client: server.Client()}
	if err := adapter.VerifyMandate(mandate, "central-wallet-session"); err != nil {
		t.Fatal(err)
	}
	proof, err := adapter.SubmitTestnet(mandate, TestnetOrder{Market: mandate.Market, Side: "buy", Price: 1_000_000, Amount: 1_000_000, IdempotencyKey: "quant-order-1", WalletSignature: "independent-order-signature"}, "central-wallet-session")
	if err != nil || len(proof) != 64 || requests != 2 {
		t.Fatalf("proof=%q requests=%d err=%v", proof, requests, err)
	}
}

func TestHTTPExchangeAdapterFailsClosed(t *testing.T) {
	adapter := HTTPExchangeAdapter{BaseURL: "file:///tmp/exchange"}
	if err := adapter.VerifyMandate(Mandate{}, "secret"); err != ErrUnavailable {
		t.Fatalf("invalid transport accepted: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
	}))
	defer server.Close()
	adapter = HTTPExchangeAdapter{BaseURL: server.URL, Client: server.Client()}
	if err := adapter.VerifyMandate(Mandate{}, "expired"); err != ErrForbidden {
		t.Fatalf("authorization failure was not preserved: %v", err)
	}
}
