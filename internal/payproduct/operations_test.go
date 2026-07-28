package payproduct

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestMerchantOperationsTenantFiltersCursorAndRedaction(t *testing.T) {
	now := time.Date(2026, 7, 27, 16, 0, 0, 0, time.UTC)
	current := now
	service, _ := testService(t, &fakePay{}, func() time.Time { return current })
	merchant, _ := onboard(t, service)
	foreignMerchantID := "mrc_foreign_ops"

	if err := service.store.Update(func(data *Snapshot) error {
		data.Invoices["inv_new"] = Invoice{Version: 1, ID: "inv_new", CentralID: "central_new", IntentID: "intent_new", MerchantID: merchant.ID, Description: "Blue enterprise order", Amount: 30, Asset: NativeAsset, Network: ChainID, Status: "pending", CreatedAt: now}
		data.Invoices["inv_old"] = Invoice{Version: 1, ID: "inv_old", CentralID: "central_old", IntentID: "intent_old", MerchantID: merchant.ID, Description: "Earlier order", Amount: 20, Asset: NativeAsset, Network: ChainID, Status: "committed", CreatedAt: now.Add(-time.Minute), Settlement: &SettlementEvidence{TransactionHash: "tx_test_value", Status: "committed", CommittedAt: now.Add(-30 * time.Second), Source: "authoritative-central-pay-api"}}
		data.Refunds["rfd_ops"] = RefundRequest{ID: "rfd_ops", InvoiceID: "inv_old", MerchantID: merchant.ID, Payer: "payer_ops", Amount: 5, Reason: "Duplicate charge", Status: "requested", CreatedAt: now.Add(-2 * time.Minute), UpdatedAt: now.Add(-2 * time.Minute)}
		data.Disputes["dsp_ops"] = Dispute{ID: "dsp_ops", InvoiceID: "inv_old", MerchantID: merchant.ID, Payer: "payer_ops", Reason: "Service not received", Status: "open", CreatedAt: now.Add(-3 * time.Minute), UpdatedAt: now.Add(-3 * time.Minute)}
		data.Deliveries["whd_ops"] = WebhookDelivery{ID: "whd_ops", MerchantID: merchant.ID, EventType: "invoice.committed", ObjectID: "inv_old", Endpoint: "https://merchant.invalid/events", PayloadHash: hashString("payload", "whd_ops"), Signature: hashString("auth", "whd_ops"), SecretVersion: 1, Attempt: 2, Status: "retrying", HTTPStatus: 503, NextAttemptAt: now.Add(time.Minute), CreatedAt: now.Add(-4 * time.Minute), UpdatedAt: now.Add(-time.Minute)}
		data.Invoices["inv_foreign"] = Invoice{Version: 1, ID: "inv_foreign", MerchantID: foreignMerchantID, Description: "Foreign tenant record", Amount: 999, Asset: NativeAsset, Network: ChainID, Status: "pending", CreatedAt: now.Add(time.Minute)}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	page, err := service.MerchantOperations(merchant.ID, MerchantOperationQuery{Kind: "all", Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if page.SchemaVersion != 1 || page.TotalMatched != 5 || len(page.Items) != 2 || page.NextCursor == "" {
		t.Fatalf("unexpected first operation page: %+v", page)
	}
	if page.Items[0].ID != "inv_new" || page.Items[1].ID != "inv_old" {
		t.Fatalf("operation sort order is not deterministic: %+v", page.Items)
	}

	seen := map[string]bool{}
	cursor := page.NextCursor
	for _, item := range page.Items {
		seen[item.ID] = true
	}
	for cursor != "" {
		next, err := service.MerchantOperations(merchant.ID, MerchantOperationQuery{Kind: "all", Limit: 2, Cursor: cursor})
		if err != nil {
			t.Fatal(err)
		}
		for _, item := range next.Items {
			if seen[item.ID] || item.MerchantID != merchant.ID {
				t.Fatalf("cursor repeated or leaked operation: %+v", item)
			}
			seen[item.ID] = true
		}
		cursor = next.NextCursor
	}
	if len(seen) != 5 {
		t.Fatalf("cursor pagination missed operations: %+v", seen)
	}

	filtered, err := service.MerchantOperations(merchant.ID, MerchantOperationQuery{Kind: "webhook", Status: "retrying", Search: "invoice.committed", Limit: 10})
	if err != nil || len(filtered.Items) != 1 || filtered.Items[0].ID != "whd_ops" {
		t.Fatalf("operation filters/search failed: %+v %v", filtered, err)
	}
	raw, _ := json.Marshal(filtered)
	for _, forbidden := range []string{"endpoint", "signature", "payloadHash", foreignMerchantID} {
		if bytes.Contains(raw, []byte(forbidden)) {
			t.Fatalf("operation response exposed private or foreign field %q: %s", forbidden, raw)
		}
	}

	search, err := service.MerchantOperations(merchant.ID, MerchantOperationQuery{Kind: "invoice", Search: "blue enterprise", Limit: 10})
	if err != nil || len(search.Items) != 1 || search.Items[0].ID != "inv_new" {
		t.Fatalf("invoice search failed: %+v %v", search, err)
	}
	from := now.Add(-150 * time.Second)
	window, err := service.MerchantOperations(merchant.ID, MerchantOperationQuery{Kind: "all", From: &from, Limit: 10})
	if err != nil || window.TotalMatched != 3 {
		t.Fatalf("operation time window failed: %+v %v", window, err)
	}

	tampered := page.NextCursor[:len(page.NextCursor)-1] + "0"
	if _, err := service.MerchantOperations(merchant.ID, MerchantOperationQuery{Kind: "all", Limit: 2, Cursor: tampered}); err == nil {
		t.Fatal("tampered operation cursor was accepted")
	}
	if _, err := service.MerchantOperations(merchant.ID, MerchantOperationQuery{Kind: "invoice", Limit: 2, Cursor: page.NextCursor}); err == nil {
		t.Fatal("operation cursor was accepted with different filters")
	}
	current = now.Add(merchantOperationCursorTTL + time.Second)
	if _, err := service.MerchantOperations(merchant.ID, MerchantOperationQuery{Kind: "all", Limit: 2, Cursor: page.NextCursor}); err == nil {
		t.Fatal("expired operation cursor was accepted")
	}

	_ = strings.Builder{}
}
