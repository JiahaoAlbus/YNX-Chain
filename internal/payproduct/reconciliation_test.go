package payproduct

import (
	"encoding/csv"
	"strings"
	"testing"
	"time"
)

func TestReconciliationCSVGoldenSchemaAndEvidenceFields(t *testing.T) {
	created := time.Date(2026, 7, 22, 8, 1, 2, 0, time.UTC)
	expires := created.Add(30 * time.Minute)
	items := []Invoice{
		{ID: "inv_pending", CentralID: "central_pending", MerchantID: "mrc_truth", Amount: 100, Fee: 1, Status: "pending", CreatedAt: created, ExpiresAt: expires},
		{ID: "inv_committed", CentralID: "central_committed", MerchantID: "mrc_truth", Amount: 250, Fee: 1, Status: "committed", CreatedAt: created, ExpiresAt: expires, Settlement: &SettlementEvidence{TransactionHash: "0xabc123", BlockNumber: 42}},
	}

	encoded, err := encodeReconciliationCSV(items)
	if err != nil {
		t.Fatal(err)
	}
	golden := "invoice_id,central_invoice_id,merchant_id,amount_ynxt,fee_ynxt,status,transaction_hash,block_number,created_at,expires_at\n" +
		"inv_pending,central_pending,mrc_truth,100,1,pending,,,2026-07-22T08:01:02Z,2026-07-22T08:31:02Z\n" +
		"inv_committed,central_committed,mrc_truth,250,1,committed,0xabc123,42,2026-07-22T08:01:02Z,2026-07-22T08:31:02Z\n"
	if string(encoded) != golden {
		t.Fatalf("reconciliation CSV changed without a schema version migration:\n%s", encoded)
	}
	records, err := csv.NewReader(strings.NewReader(string(encoded))).ReadAll()
	if err != nil || len(records) != 3 || len(records[0]) != 10 {
		t.Fatalf("reconciliation CSV is not parseable with the declared schema: rows=%d err=%v", len(records), err)
	}
	if reconciliationSchemaVersion != "1" {
		t.Fatalf("golden fixture must be migrated with schema version, got %q", reconciliationSchemaVersion)
	}
}
