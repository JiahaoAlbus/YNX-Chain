package commerce

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestBusinessNativeInvoiceUnboundNeverFallsThroughToLegacyCreator(t *testing.T) {
	s, buyer, order := effectOrderFixture(t, filepath.Join(t.TempDir(), "state.json"))
	calls := 0
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(500) }))
	defer legacy.Close()
	server := NewServer(s, ServerConfig{NativeInvoiceOnly: true, businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, Pay: HTTPPayVerifier{BaseURL: legacy.URL, APIKey: "PUBLIC-old-service", MerchantID: "PUBLIC-old-merchant", PayoutAddress: buyer}})
	w := businessHTTPRequest(server, "POST", "/api/orders/"+order.ID+"/pay-handoff", strings.Repeat("g", 43), `{"IdempotencyKey":"original-native-preparation"}`)
	if w.Code != 503 || !bytes.Contains(w.Body.Bytes(), []byte("NATIVE_INVOICE_SOURCE_REQUIRED")) || calls != 0 || len(s.s.BusinessEffects) != 0 || len(s.s.BusinessNonces) != 0 || hasInvoiceBinding(s.s.Orders[order.ID]) {
		t.Fatal(w.Code, w.Body.String(), calls)
	}
}

func TestBusinessNativeInvoiceRetainsHistoricalBoundReadWithoutCreator(t *testing.T) {
	s, order, buyer, _ := invoiceRecoveryFixture(t)
	server := NewServer(s, ServerConfig{NativeInvoiceOnly: true, businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}})
	w := businessHTTPRequest(server, "POST", "/api/orders/"+order.ID+"/pay-handoff", strings.Repeat("h", 43), `{"IdempotencyKey":"historical-original-only"}`)
	if w.Code != 201 || len(s.s.BusinessEffects) != 0 || !bytes.Contains(w.Body.Bytes(), []byte("inv_original")) {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestBusinessNativeInvoiceNeverSynthesizesLegacyWalletURI(t *testing.T) {
	_, _, order := nativeIntentOrderFixture(t)
	if result, err := boundInvoiceHandoff(order); err != ErrInvalidState || result.DeepLink != "" {
		t.Fatal("native invoice synthesized legacy approval URI", result, err)
	}
}
