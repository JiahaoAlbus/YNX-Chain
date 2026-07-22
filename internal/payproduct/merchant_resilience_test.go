package payproduct

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

var merchantPermissions = []string{"read", "invoice", "reconcile", "case", "webhook", "ai-run", "ai-review", "members", "provider-manage", "provider-test"}

func FuzzMerchantRBACFailsClosed(f *testing.F) {
	for _, role := range []string{"owner", "finance", "developer", "support", "viewer", "", "OWNER", "admin", "owner\x00"} {
		for _, permission := range append(append([]string{}, merchantPermissions...), "", "refund", "*", "members:write") {
			f.Add(role, permission)
		}
	}
	f.Fuzz(func(t *testing.T, role, permission string) {
		if roleAllows(role, permission) && (!validMerchantRole(role) || !containsString(merchantPermissions, permission)) {
			t.Fatalf("unknown role or permission was authorized: role=%q permission=%q", role, permission)
		}
	})
}

func FuzzWebhookSignatureBindsEveryField(f *testing.F) {
	f.Add("evt_01", int64(1_786_000_000), strings.Repeat("a", 64))
	f.Add("evt_replay", int64(0), strings.Repeat("0", 64))
	f.Fuzz(func(t *testing.T, eventID string, unixSeconds int64, payloadHash string) {
		if len(eventID) > 256 || len(payloadHash) > 256 {
			t.Skip()
		}
		at := time.Unix(unixSeconds, 123).UTC()
		base := webhookSigningMaterial(eventID, at, payloadHash)
		variants := [][]byte{
			webhookSigningMaterial(eventID+"x", at, payloadHash),
			webhookSigningMaterial(eventID, at.Add(time.Nanosecond), payloadHash),
			webhookSigningMaterial(eventID, at, payloadHash+"x"),
		}
		for i, variant := range variants {
			if string(base) == string(variant) {
				t.Fatalf("webhook signature material did not bind field %d", i)
			}
		}
	})
}

func FuzzSettlementEvidenceFailsClosed(f *testing.F) {
	for field := uint8(0); field < 12; field++ {
		f.Add(field, "mutation")
	}
	f.Fuzz(func(t *testing.T, field uint8, mutation string) {
		if len(mutation) > 128 {
			t.Skip()
		}
		if mutation == "" {
			mutation = "x"
		}
		invoice, merchant, evidence := settlementFixture()
		if !validSettlementEvidence(invoice, merchant, evidence) {
			t.Fatal("valid settlement fixture was rejected")
		}
		switch field % 12 {
		case 0:
			evidence.ID = ""
		case 1:
			evidence.InvoiceID += mutation
		case 2:
			evidence.IntentID += mutation
		case 3:
			evidence.Merchant += mutation
		case 4:
			evidence.PayoutAddress += mutation
		case 5:
			evidence.Amount++
		case 6:
			evidence.Currency += mutation
		case 7:
			evidence.Status = "pending"
		case 8:
			evidence.TransactionHash = ""
		case 9:
			evidence.BlockNumber = 0
		case 10:
			evidence.AuditHash = ""
		case 11:
			evidence.PayoutAddress = "ynx1wrongdestination"
		}
		if validSettlementEvidence(invoice, merchant, evidence) {
			t.Fatalf("mutated settlement evidence was accepted for field %d", field%12)
		}
	})
}

func TestMerchantFaultMatrixFailsClosed(t *testing.T) {
	now := time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC)
	pay := &fakePay{settlementErr: errors.New("authoritative provider unavailable")}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.ID, merchant.PayoutAddress, 7
	invoice, err := service.CreateInvoice(t.Context(), merchant, InvoiceInput{Amount: 7, ExpiresInMinutes: 30, IdempotencyKey: "fault-invoice-01"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SubmitSettlement(t.Context(), invoice.ID, merchant.PayoutAddress, "0x"+strings.Repeat("a", 64), "fault-settlement-01"); err == nil {
		t.Fatal("provider outage was reported as a successful settlement")
	}
	unchanged, err := service.Invoice(t.Context(), invoice.ID)
	if err != nil || unchanged.Status != "pending" || unchanged.Settlement != nil {
		t.Fatalf("provider fault mutated settlement state: %+v %v", unchanged, err)
	}
	for _, role := range []string{"finance", "developer", "support", "viewer", "", "admin"} {
		if roleAllows(role, "members") {
			t.Fatalf("role %q gained owner-only membership authority", role)
		}
	}
}

func TestMerchantRBACWebhookSettlementSoak(t *testing.T) {
	invoice, merchant, evidence := settlementFixture()
	started := time.Now()
	permissions := append(append([]string{}, merchantPermissions...), "unknown")
	const iterations = 100_000
	for i := 0; i < iterations; i++ {
		role := []string{"owner", "finance", "developer", "support", "viewer", "invalid"}[i%6]
		permission := permissions[i%len(permissions)]
		allowed := roleAllows(role, permission)
		if allowed && (!validMerchantRole(role) || !containsString(merchantPermissions, permission)) {
			t.Fatalf("iteration %d authorized an unknown RBAC tuple", i)
		}
		payload := sha256.Sum256([]byte(fmt.Sprintf("merchant-soak-%d", i)))
		material := webhookSigningMaterial(fmt.Sprintf("evt_%d", i), time.Unix(int64(i), 0).UTC(), hex.EncodeToString(payload[:]))
		if len(material) == 0 {
			t.Fatalf("iteration %d produced empty webhook signing material", i)
		}
		if !validSettlementEvidence(invoice, merchant, evidence) {
			t.Fatalf("iteration %d rejected authoritative settlement evidence", i)
		}
	}
	t.Logf("merchant resilience soak completed iterations=%d elapsed=%s", iterations, time.Since(started))
}

func BenchmarkMerchantRBAC(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = roleAllows("finance", "reconcile")
	}
}

func BenchmarkWebhookSigningMaterial(b *testing.B) {
	at := time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC)
	for i := 0; i < b.N; i++ {
		_ = webhookSigningMaterial("evt_benchmark", at, strings.Repeat("a", 64))
	}
}

func BenchmarkSettlementEvidenceValidation(b *testing.B) {
	invoice, merchant, evidence := settlementFixture()
	for i := 0; i < b.N; i++ {
		_ = validSettlementEvidence(invoice, merchant, evidence)
	}
}

func settlementFixture() (Invoice, Merchant, chain.PaySettlement) {
	merchant := Merchant{ID: "mrc_truth", CentralMerchantID: "central_truth", PayoutAddress: "ynx1truthdestination"}
	invoice := Invoice{CentralID: "inv_truth", IntentID: "intent_truth", MerchantID: merchant.ID, PayoutAddress: merchant.PayoutAddress, Amount: 42, Asset: NativeAsset}
	evidence := chain.PaySettlement{ID: "set_truth", InvoiceID: invoice.CentralID, IntentID: invoice.IntentID, Merchant: merchant.CentralMerchantID, PayoutAddress: invoice.PayoutAddress, Amount: invoice.Amount, Currency: invoice.Asset, Status: "paid", TransactionHash: "0x" + strings.Repeat("a", 64), BlockNumber: 1, AuditHash: strings.Repeat("b", 64)}
	return invoice, merchant, evidence
}

func containsString(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}
