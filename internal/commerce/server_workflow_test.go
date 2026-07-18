package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func requestJSON(t *testing.T, client *http.Client, method, endpoint, token string, body any, want int, out any) {
	t.Helper()
	var data []byte
	if body != nil {
		data, _ = json.Marshal(body)
	}
	req, err := http.NewRequest(method, endpoint, bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != want {
		var failure map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&failure)
		t.Fatalf("%s %s status=%d want=%d body=%v", method, endpoint, resp.StatusCode, want, failure)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
}

type testAuth struct{ principals map[string]Principal }

func (a testAuth) Available() bool { return true }
func (a testAuth) Verify(_ context.Context, token string) (Principal, error) {
	p, ok := a.principals[token]
	if !ok {
		return Principal{}, ErrUnauthorized
	}
	return p, nil
}
func (a testAuth) Begin(context.Context, json.RawMessage) (json.RawMessage, error) {
	return nil, errors.New("not used")
}
func (a testAuth) Complete(context.Context, json.RawMessage) (json.RawMessage, error) {
	return nil, errors.New("not used")
}

func principal(account, role string) Principal {
	binding := ShopBinding()
	if role == "seller" {
		binding = SellerBinding()
	}
	return Principal{Account: account, Role: role, ProductClientID: binding.ProductClientID, BundleID: binding.BundleID, SessionBinding: strings.Repeat("a", 64), Scopes: binding.Scopes, ExpiresAt: time.Now().UTC().Add(time.Hour)}
}

func TestHTTPMarketplaceBuyerSellerSettlementAndResolutionLoop(t *testing.T) {
	store, err := Open(t.TempDir() + "/state.json")
	if err != nil {
		t.Fatal(err)
	}
	_, sellerAccount := actor(t, 41)
	_, buyerAccount := actor(t, 42)
	_, supportAccount := actor(t, 43)
	pay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/pay/intents":
			fmt.Fprint(w, "{\"id\":\"intent_shop_1\"}")
		case r.Method == http.MethodPost && r.URL.Path == "/pay/invoices":
			fmt.Fprint(w, "{\"id\":\"invoice_shop_1\"}")
		case r.Method == http.MethodGet && r.URL.Path == "/pay/invoices/invoice_shop_1/settlement":
			_ = json.NewEncoder(w).Encode(SettlementEvidence{InvoiceID: "invoice_shop_1", IntentID: "intent_shop_1", Merchant: "merchant_shop_1", PayoutAddress: sellerAccount, TransactionHash: "0x" + strings.Repeat("a", 64), Status: "paid", Payer: buyerAccount, Currency: NativeSymbol, AuditHash: strings.Repeat("b", 64), AmountYNXT: 25, BlockHeight: 55, ConfirmedAt: time.Now().UTC()})
		case r.Method == http.MethodPost && r.URL.Path == "/pay/refunds":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "refund_shop_1", "signer": sellerAccount, "merchant": "merchant_shop_1", "intentId": "intent_shop_1", "amount": 25, "currency": NativeSymbol, "reason": "approved return", "status": "recorded", "createdAt": time.Now().UTC(), "idempotencyKey": "shop-refund-transition-refund-approve", "requestHash": strings.Repeat("c", 64), "blockHeight": 56, "txHash": strings.Repeat("d", 64), "auditHash": strings.Repeat("e", 64)})
		default:
			http.NotFound(w, r)
		}
	}))
	defer pay.Close()
	auth := testAuth{principals: map[string]Principal{"seller-token-abcdefghijkl": principal(sellerAccount, "seller"), "buyer-token-abcdefghijklmn": principal(buyerAccount, "buyer"), "support-token-abcdefghijk": principal(supportAccount, "seller")}}
	server := httptest.NewServer(NewServer(store, ServerConfig{Auth: auth, Pay: HTTPPayVerifier{BaseURL: pay.URL, APIKey: "pay-test-key", MerchantID: "merchant_shop_1", PayoutAddress: sellerAccount}}).Handler())
	defer server.Close()
	client := server.Client()
	sellerToken := "seller-token-abcdefghijkl"
	buyerToken := "buyer-token-abcdefghijklmn"
	supportToken := "support-token-abcdefghijk"
	var merchant StoreProfile
	requestJSON(t, client, http.MethodPost, server.URL+"/api/seller/stores", sellerToken, CreateStoreInput{Name: "Loop Store", Policy: "Returns reviewed with evidence", TrustURL: "https://trust.example/case", IdempotencyKey: "http-store-key-1"}, http.StatusCreated, &merchant)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/seller/stores/"+merchant.ID+"/activate", sellerToken, map[string]any{}, http.StatusOK, &merchant)
	requestJSON(t, client, http.MethodPut, server.URL+"/api/seller/stores/"+merchant.ID+"/roles", sellerToken, map[string]any{"Account": supportAccount, "Role": "support"}, http.StatusOK, nil)
	var product Product
	requestJSON(t, client, http.MethodPost, server.URL+"/api/seller/products", sellerToken, CreateProductInput{StoreID: merchant.ID, Title: "Field kit", Description: "Verified", Category: "outdoor", Media: []MediaAsset{{URL: "https://media.example/field-kit.jpg", AltText: "Blue field kit", Kind: "image"}}, Variants: []Variant{{Name: "Blue", SKU: "HTTP-BLUE", PriceYNXT: 25, Inventory: 1}}, IdempotencyKey: "http-product-key-1"}, http.StatusCreated, &product)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/seller/products/"+product.ID+"/publish", sellerToken, map[string]any{}, http.StatusOK, &product)
	requestJSON(t, client, http.MethodPut, server.URL+"/api/cart", buyerToken, map[string]any{"Items": []CartItem{{ProductID: product.ID, VariantID: product.Variants[0].ID, Quantity: 1}}}, http.StatusOK, nil)
	var order Order
	requestJSON(t, client, http.MethodPost, server.URL+"/api/orders", buyerToken, OrderInput{StoreID: merchant.ID, Items: []CartItem{{ProductID: product.ID, VariantID: product.Variants[0].ID, Quantity: 1}}, Address: Address{Recipient: "Buyer", Line1: "1 Road", City: "Shenzhen", Country: "CN"}, IdempotencyKey: "http-order-key-01"}, http.StatusCreated, &order)
	if order.Status != "payment_pending" {
		t.Fatalf("new order status=%s", order.Status)
	}
	var handoff struct {
		Order                       Order
		InvoiceID, DeepLink, Status string
	}
	requestJSON(t, client, http.MethodPost, server.URL+"/api/orders/"+order.ID+"/pay-handoff", buyerToken, map[string]any{"IdempotencyKey": "http-pay-key-001"}, http.StatusCreated, &handoff)
	if handoff.Status != "payment_pending" || handoff.InvoiceID != "invoice_shop_1" {
		t.Fatalf("bad handoff: %+v", handoff)
	}
	requestJSON(t, client, http.MethodPost, server.URL+"/api/orders/"+order.ID+"/confirm-payment", buyerToken, map[string]any{}, http.StatusOK, &order)
	if order.Status != "paid" || order.Settlement == nil || order.Settlement.BlockHeight != 55 {
		t.Fatalf("payment not proven: %+v", order)
	}
	shipment := map[string]any{"Action": "shipped", "Carrier": "seller-entered", "TrackingNumber": "TRACK-1", "IdempotencyKey": "transition-ship-01"}
	requestJSON(t, client, http.MethodPost, server.URL+"/api/orders/"+order.ID+"/transition", sellerToken, shipment, http.StatusOK, &order)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/orders/"+order.ID+"/transition", sellerToken, shipment, http.StatusOK, &order)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/orders/"+order.ID+"/transition", buyerToken, map[string]any{"Action": "delivered", "IdempotencyKey": "transition-deliver-01"}, http.StatusOK, &order)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/orders/"+order.ID+"/transition", buyerToken, map[string]any{"Action": "reviewed", "Rating": 5, "Body": "Matched listing", "IdempotencyKey": "transition-review-01"}, http.StatusOK, &order)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/orders/"+order.ID+"/transition", buyerToken, map[string]any{"Action": "return_requested", "Reason": "changed mind", "Explanation": "within policy", "IdempotencyKey": "transition-return-01"}, http.StatusOK, &order)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/orders/"+order.ID+"/transition", supportToken, map[string]any{"Action": "return_approved", "IdempotencyKey": "transition-return-approve"}, http.StatusOK, &order)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/orders/"+order.ID+"/transition", buyerToken, map[string]any{"Action": "refund_requested", "Reason": "approved return", "Explanation": "request Pay refund review", "IdempotencyKey": "transition-refund-01"}, http.StatusOK, &order)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/orders/"+order.ID+"/transition", supportToken, map[string]any{"Action": "refund_approved", "IdempotencyKey": "transition-refund-deny"}, http.StatusConflict, nil)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/orders/"+order.ID+"/transition", sellerToken, map[string]any{"Action": "refund_approved", "IdempotencyKey": "transition-refund-approve"}, http.StatusOK, &order)
	if order.Status != "refunded" || order.Settlement == nil || order.Refund == nil || order.Refund.BlockHeight != 56 {
		t.Fatalf("resolution lost evidence: %+v", order)
	}
	var settlements struct{ Settlements []SettlementEvidence }
	requestJSON(t, client, http.MethodGet, server.URL+"/api/seller/settlements", sellerToken, nil, http.StatusOK, &settlements)
	if len(settlements.Settlements) != 1 {
		t.Fatalf("settlements=%d", len(settlements.Settlements))
	}
	requestJSON(t, client, http.MethodGet, server.URL+"/api/orders", "", nil, http.StatusUnauthorized, nil)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/seller/stores", sellerToken, map[string]any{"Name": "bad", "unknown": true}, http.StatusBadRequest, nil)
}
