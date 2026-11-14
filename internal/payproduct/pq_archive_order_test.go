//go:build pay_pq

package payproduct

import (
	"strings"
	"testing"
)

// PUBLIC DATA controls for aggregation only; actual independent proof and
// projection coverage uses the normal HTTP/cold Store integration test.
func archiveOrderFixture() (NativeInvoiceProductIntent, NativeInvoiceIntentView, map[string]NativePayArchiveReceipt) {
	original := NativeInvoiceProductIntent{ProductID: "shop.order", SourceOrder: "order-original", AmountAtoms: "100"}
	hash := func(c string) string { return "0x" + strings.Repeat(c, 64) }
	payment, refund1, refund2 := hash("f"), hash("a"), hash("1")
	rows := map[string]NativePayArchiveReceipt{}
	rows[payment] = NativePayArchiveReceipt{NativeHash: payment, Kind: "invoice_settle", Status: "confirmed", PrincipalAtoms: "100", PaidAtoms: "100", RefundedAtoms: "0", NetPaidAtoms: "100", ExecutionHeight: "42", ExecutionIndex: "2", ExecutionMember: "0", ExecutionEvent: "0"}
	rows[refund1] = NativePayArchiveReceipt{NativeHash: refund1, Kind: "invoice_refund", Status: "confirmed", SettlementNativeHash: payment, RefundID: "return-first", PrincipalAtoms: "30", PaidAtoms: "100", RefundedAtoms: "30", NetPaidAtoms: "70", ExecutionHeight: "42", ExecutionIndex: "3", ExecutionMember: "0", ExecutionEvent: "0"}
	rows[refund2] = NativePayArchiveReceipt{NativeHash: refund2, Kind: "invoice_refund", Status: "confirmed", SettlementNativeHash: payment, RefundID: "return-second", PrincipalAtoms: "20", PaidAtoms: "100", RefundedAtoms: "50", NetPaidAtoms: "50", ExecutionHeight: "42", ExecutionIndex: "3", ExecutionMember: "1", ExecutionEvent: "0"}
	operations := map[string]NativePayOperation{}
	for h, r := range rows {
		operations[h] = NativePayOperation{NativePayOriginal: NativePayOriginal{NativeHash: h}, Kind: r.Kind, Status: r.Status}
	}
	intent := NativeInvoiceIntentView{Invoice: map[string]any{"operations": operations}}
	return original, intent, rows
}
func aggregateArchiveOrder(original NativeInvoiceProductIntent, intent NativeInvoiceIntentView, rows map[string]NativePayArchiveReceipt) (NativePayArchiveReconciliation, error) {
	return nativeArchiveReconciliationForIntent(original, "invoice-original", intent, func(h string) (NativePayArchiveReceipt, error) { return rows[h], nil }, func() (NativeInvoiceIntentView, error) { return intent, nil })
}
func TestNativeArchiveSameBlockRefundsUseExecutionCoordinates(t *testing.T) {
	original, intent, rows := archiveOrderFixture()
	out, err := aggregateArchiveOrder(original, intent, rows)
	if err != nil {
		t.Fatal(err)
	}
	if out.PaidAtoms != "100" || out.RefundedAtoms != "50" || out.NetPaidAtoms != "50" || !out.CompleteKnownOriginals || len(out.Receipts) != 3 || out.Receipts[0].Kind != "invoice_settle" || out.Receipts[1].RefundID != "return-first" || out.Receipts[2].RefundID != "return-second" {
		t.Fatalf("execution order/cumulative refund changed: %+v", out)
	}
}
func TestNativeArchiveRejectsAmbiguousCoordinatesOrRefundIdentity(t *testing.T) {
	for _, name := range []string{"duplicate-coordinate", "noncanonical-coordinate", "bad-index", "duplicate-refund", "missing-refund", "incomplete-cumulative"} {
		t.Run(name, func(t *testing.T) {
			original, intent, rows := archiveOrderFixture()
			h := "0x" + strings.Repeat("1", 64)
			r := rows[h]
			switch name {
			case "duplicate-coordinate":
				r.ExecutionMember = "0"
			case "noncanonical-coordinate":
				r.ExecutionIndex = "03"
			case "bad-index":
				r.ExecutionIndex = "4294967296"
			case "duplicate-refund":
				r.RefundID = "return-first"
			case "missing-refund":
				r.RefundID = ""
			case "incomplete-cumulative":
				r.RefundedAtoms = "20"
				r.NetPaidAtoms = "80"
			}
			rows[h] = r
			if _, err := aggregateArchiveOrder(original, intent, rows); err == nil {
				t.Fatal("ambiguous/incomplete original history accepted")
			}
		})
	}
}
