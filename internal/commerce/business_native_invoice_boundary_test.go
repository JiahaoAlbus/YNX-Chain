package commerce

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
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

func TestBusinessNativeInvoiceCannotSettleThroughLegacyPayEvidence(t *testing.T) {
	s, buyer, order, evidence := settlementFixture(t)
	order.PayIntentID = "npi_" + strings.Repeat("ab", 24)
	evidence.IntentID = order.PayIntentID
	s.s.Orders[order.ID] = order
	if err := s.persistLocked(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(s.path)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := cloneSnapshot(s.s)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConfirmSettlement(order.ID, evidence); !errors.Is(err, ErrInvalidState) {
		t.Fatal("Native original accepted legacy display-unit settlement", err)
	}
	afterStore, err := os.ReadFile(s.path)
	if err != nil || !bytes.Equal(before, afterStore) || !reflect.DeepEqual(snapshot, s.s) {
		t.Fatal("refused Native Store apply altered original persisted state", err)
	}
	calls := 0
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; json.NewEncoder(w).Encode(evidence) }))
	defer legacy.Close()
	cfg := ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, Pay: HTTPPayVerifier{BaseURL: legacy.URL, APIKey: "PUBLIC-old-pay"}}
	w := businessHTTPRequest(NewServer(s, cfg), "POST", "/api/orders/"+order.ID+"/confirm-payment", strings.Repeat("z", 43), `{}`)
	if w.Code != 503 || calls != 0 {
		t.Fatal("Native confirmation reached legacy provider", w.Code, w.Body.String(), calls)
	}
	// Normal HTTP middleware retains its abuse counter even on a rejection.
	// Every other persisted field must remain identical to the original.
	afterHTTP, err := cloneSnapshot(s.s)
	if err != nil {
		t.Fatal(err)
	}
	if len(afterHTTP.RequestWindow) != 1 {
		t.Fatal("unexpected HTTP counter set", afterHTTP.RequestWindow)
	}
	for _, window := range afterHTTP.RequestWindow {
		if len(window) != 1 {
			t.Fatal("unexpected HTTP dispatch count", len(window))
		}
	}
	afterHTTP.RequestWindow = snapshot.RequestWindow
	if !reflect.DeepEqual(snapshot, afterHTTP) {
		t.Fatal("refused HTTP Native settlement changed business state")
	}
	cold, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	coldState, err := cloneSnapshot(cold.s)
	if err != nil {
		t.Fatal(err)
	}
	coldState.RequestWindow = snapshot.RequestWindow
	if !reflect.DeepEqual(snapshot, coldState) {
		t.Fatal("cold original business state changed after legacy rejection")
	}
	if _, err := cold.ConfirmSettlement(order.ID, evidence); !errors.Is(err, ErrInvalidState) {
		t.Fatal("cold Native original accepted legacy evidence", err)
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

func TestBusinessNativeInvoiceCannotRefundThroughLegacyPayEvidence(t *testing.T) {
	s, _, order, evidence := settlementFixture(t)
	_, owner := actor(t, 1)
	order.PayIntentID = "npi_" + strings.Repeat("ab", 24)
	evidence.IntentID = order.PayIntentID
	// Preserve a historical/corrupt legacy projection without legitimizing it.
	order.Status = "refund_approved"
	order.Settlement = &evidence
	s.s.Orders[order.ID] = order
	if err := s.persistLocked(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(s.path)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := cloneSnapshot(s.s)
	if err != nil {
		t.Fatal(err)
	}
	refund := RefundEvidence{ID: "PUBLIC-refund", IntentID: order.PayIntentID, Merchant: order.PayMerchant, Currency: NativeSymbol, Status: "recorded", AmountYNXT: order.TotalYNXT, BlockHeight: 43, RecordedAt: time.Now().UTC(), TransactionHash: strings.Repeat("a", 64), AuditHash: strings.Repeat("b", 64), RequestHash: strings.Repeat("c", 64)}
	if _, err := s.BindRefundEvidence(owner, order.ID, refund); !errors.Is(err, ErrInvalidState) {
		t.Fatal("Native original accepted legacy refund evidence", err)
	}
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; json.NewEncoder(w).Encode(refund) }))
	defer provider.Close()
	pay := HTTPPayVerifier{BaseURL: provider.URL, APIKey: "PUBLIC-old-pay", MerchantID: order.PayMerchant}
	if _, err := pay.CreateRefund(t.Context(), order, "PUBLIC-original-refund"); !errors.Is(err, ErrInvalidState) || calls != 0 {
		t.Fatal("Native refund reached legacy provider", err, calls)
	}
	after, err := os.ReadFile(s.path)
	if err != nil || !bytes.Equal(before, after) || !reflect.DeepEqual(snapshot, s.s) {
		t.Fatal("refused legacy Native refund altered retained history", err)
	}
	cold, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cold.BindRefundEvidence(owner, order.ID, refund); !errors.Is(err, ErrInvalidState) {
		t.Fatal("cold Native original accepted legacy refund evidence", err)
	}
}

func TestBusinessNativeInvoiceNeverSynthesizesLegacyWalletURI(t *testing.T) {
	_, _, order := nativeIntentOrderFixture(t)
	if result, err := boundInvoiceHandoff(order); err != ErrInvalidState || result.DeepLink != "" {
		t.Fatal("native invoice synthesized legacy approval URI", result, err)
	}
}
