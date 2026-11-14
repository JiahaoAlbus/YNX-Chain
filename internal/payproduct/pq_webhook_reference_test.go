//go:build pay_pq && pay_webhook_original

package payproduct

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Projection delta over the exact retained5f Core fixture. Its five original
// H/H+1 proofs remain existing evidence and are not re-executed by this test.
func TestNativeWebhookReferenceUsesRetainedCoreOriginalsOnly(t *testing.T) {
	dir := os.Getenv("PAY_MULTI_REFUND_WORKFLOW_DIR")
	if !filepath.IsAbs(dir) {
		t.Fatal("exact original five-row fixture required")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != "9762c64fda815955f8d9be73df232fb718e8909e46c54530c9743a3d944e6b59" {
		t.Fatal("retained actual Core fixture changed")
	}
	var f struct {
		Rows []struct {
			Data []byte
			Wire []byte
		}
	}
	if json.Unmarshal(raw, &f) != nil || len(f.Rows) != 5 {
		t.Fatal("original five-row fixture unavailable")
	}
	for _, row := range f.Rows {
		var e consensus.PQInvoiceEffect
		if err = json.Unmarshal(row.Data, &e); err != nil {
			t.Fatal(err)
		}
		ref := nativeInvoiceWebhookReference(NativePayInvoice{SourceOrder: "order:multi:100"}, e)
		if ref.NativeHash != consensus.SignedTransactionHash(row.Wire) || ref.Merchant != e.Merchant || ref.InvoiceID != e.InvoiceID || ref.SessionID != e.SessionID || ref.Genesis != e.Genesis || ref.NativeChainID != "6423" || ref.SourceOrder != "order:multi:100" || ref.ABCIHash != e.ABCIHash || ref.EventClaim != nativeEventClaim(e) {
			t.Fatal("notification reference changed original invoice/claim")
		}
		encoded, _ := json.Marshal(ref)
		for _, forbidden := range []string{"paidAtoms", "amountAtoms", "refundedAtoms", "permission", "NativeGrant", "member", "proof", "signature"} {
			if strings.Contains(string(encoded), forbidden) {
				t.Fatal("callback reference contains funds/authority/wire", forbidden)
			}
		}
	}
	t.Log("RETAINED_FIVE_CORE_ORIGINALS callbackreference projection PASS; originalMathReused=true fundsReexecuted=false callbackIsNotReceipt=true")
}
