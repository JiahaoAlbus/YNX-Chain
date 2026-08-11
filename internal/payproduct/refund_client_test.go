package payproduct

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestHTTPPayAPICompletesAndAdaptsAuthoritativeRefund(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	input := AuthorizedRefundSubmission{RequestID: "rfr_0123456789abcdefabcd", InvoiceID: "central-invoice-012345", IntentID: "central-intent-012345", MerchantID: "central-merchant-012345", MerchantAccount: "ynx1merchant", Payer: "ynx1payer", Amount: 2, Asset: NativeAsset, Reason: "approved return", TransactionHash: "0x" + strings.Repeat("a", 64), AuthorizationDigest: strings.Repeat("b", 64), IdempotencyKey: "refund-submit-012345"}
	completed := chain.RefundRecord{ID: "central-refund-012345", IntentID: input.IntentID, InvoiceID: input.InvoiceID, Merchant: input.MerchantID, PayoutAddress: input.MerchantAccount, Payer: input.Payer, Amount: input.Amount, Currency: input.Asset, Reason: input.Reason, Status: "completed", TransactionHash: input.TransactionHash, BlockNumber: 99, CreatedAt: now, CompletedAt: &now, IdempotencyKey: input.IdempotencyKey, CompletionIdempotencyKey: "server-bound", AuditHash: strings.Repeat("c", 64)}
	var createSeen, completeSeen, lookupSeen bool
	central := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer central-key" {
			t.Fatalf("central authorization missing")
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/pay/refunds":
			createSeen = true
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if len(body) != 4 || body["intentId"] != input.IntentID || body["amount"] != float64(input.Amount) || body["reason"] != input.Reason || body["idempotencyKey"] != input.IdempotencyKey {
				t.Fatalf("central refund create body is not the strict public contract: %+v", body)
			}
			_ = json.NewEncoder(w).Encode(chain.RefundRecord{ID: completed.ID, IntentID: input.IntentID, Amount: input.Amount, Currency: input.Asset, Status: "recorded", IdempotencyKey: input.IdempotencyKey})
		case r.Method == http.MethodPost && r.URL.Path == "/pay/refunds/"+completed.ID+"/complete":
			completeSeen = true
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["transactionHash"] != input.TransactionHash || !strings.HasPrefix(body["idempotencyKey"].(string), "refund-complete-") {
				t.Fatalf("completion body is not transaction-bound: %+v", body)
			}
			_ = json.NewEncoder(w).Encode(completed)
		case r.Method == http.MethodGet && r.URL.Path == "/pay/refunds/"+completed.ID:
			lookupSeen = true
			_ = json.NewEncoder(w).Encode(completed)
		default:
			http.NotFound(w, r)
		}
	}))
	defer central.Close()
	client := &HTTPPayAPI{BaseURL: central.URL, APIKey: "central-key", Client: central.Client()}
	record, err := client.CreateAuthorizedRefund(context.Background(), input)
	if err != nil || record.Status != "completed" || !createSeen || !completeSeen {
		t.Fatalf("refund protocol did not create and complete: %+v %v", record, err)
	}
	evidence, err := client.RefundEvidence(context.Background(), record.ID, input)
	if err != nil || !lookupSeen || evidence.Status != "refunded" || evidence.Finality != "committed" || evidence.TransactionHash != input.TransactionHash || evidence.BlockNumber != completed.BlockNumber || evidence.AuditHash != completed.AuditHash || evidence.RequestID != input.RequestID {
		t.Fatalf("central completion was not adapted to bounded evidence: %+v %v", evidence, err)
	}
}
