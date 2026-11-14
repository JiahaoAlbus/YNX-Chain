package payproduct

import (
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"strings"
	"testing"
	"time"
)

func settlementClaimFixture(t *testing.T) (*Service, Merchant, Invoice, chain.PaySettlement) {
	t.Helper()
	now := time.Date(2026, 10, 31, 10, 0, 0, 0, time.UTC)
	p := &fakePay{}
	s, _ := testService(t, p, func() time.Time { return now })
	m, _ := onboard(t, s)
	p.invoice.Merchant, p.invoice.PayoutAddress, p.invoice.Amount = m.CentralMerchantID, m.PayoutAddress, 100
	invoice, err := s.CreateInvoice(context.Background(), m, InvoiceInput{Amount: 100, ExpiresInMinutes: 30, IdempotencyKey: "receipt-original-invoice"})
	if err != nil {
		t.Fatal(err)
	}
	v := chain.PaySettlement{ID: "original-receipt-100", IntentID: invoice.IntentID, InvoiceID: invoice.CentralID, Merchant: m.CentralMerchantID, PayoutAddress: m.PayoutAddress, Payer: m.PayoutAddress, Amount: 100, Currency: NativeAsset, TransactionHash: "0x" + strings.Repeat("a", 64), BlockNumber: 100, Status: "paid", IdempotencyKey: "original-receipt-key", AuditHash: strings.Repeat("b", 64), CreatedAt: now}
	return s, m, invoice, v
}

func TestSettlementRejectsMalformedAuthoritativeReceipt(t *testing.T) {
	cases := []struct {
		name   string
		change func(*chain.PaySettlement)
	}{
		{"nonhex-transaction", func(v *chain.PaySettlement) { v.TransactionHash = "0x" + strings.Repeat("z", 64) }},
		{"nonhex-audit", func(v *chain.PaySettlement) { v.AuditHash = strings.Repeat("z", 64) }},
		{"missing-receipt-id", func(v *chain.PaySettlement) { v.ID = "" }},
		{"missing-time", func(v *chain.PaySettlement) { v.CreatedAt = time.Time{} }},
		{"missing-payer", func(v *chain.PaySettlement) { v.Payer = "" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, m, invoice, v := settlementClaimFixture(t)
			tc.change(&v)
			if _, err := s.acceptSettlement(invoice, m, v); err == nil {
				t.Fatal("malformed receipt marked invoice paid")
			}
			s.store.View(func(data Snapshot) error {
				if data.Invoices[invoice.ID].Status != "pending" || len(data.Deliveries) != 0 {
					t.Fatal("rejected receipt changed business/outbox")
				}
				return nil
			})
		})
	}
}

func TestSettlementClaimCannotBeReboundOrDuplicateAudit(t *testing.T) {
	for _, kind := range []string{"receipt", "transaction"} {
		t.Run(kind, func(t *testing.T) {
			s, m, invoice, v := settlementClaimFixture(t)
			original, err := s.acceptSettlement(invoice, m, v)
			if err != nil {
				t.Fatal(err)
			}
			var audits int
			s.store.View(func(data Snapshot) error { audits = len(data.Audit); return nil })
			replay, err := s.acceptSettlement(invoice, m, v)
			if err != nil || replay.Settlement.ID != original.Settlement.ID {
				t.Fatal(err)
			}
			s.store.View(func(data Snapshot) error {
				if len(data.Audit) != audits {
					t.Error("same receipt appended another committed audit")
				}
				return nil
			})
			p := s.pay.(*fakePay)
			s.pay = changedRegistrationPay{fakePay: p, changeIntent: func(v *chain.PayIntent) { v.ID = "another-intent" }, changeInvoice: func(v *chain.Invoice) { v.ID = "another-invoice" }}
			second, err := s.CreateInvoice(context.Background(), m, InvoiceInput{Amount: 100, ExpiresInMinutes: 30, IdempotencyKey: "second-invoice-registration"})
			if err != nil {
				t.Fatal(err)
			}
			v.IntentID, v.InvoiceID = second.IntentID, second.CentralID
			if kind == "receipt" {
				v.TransactionHash = "0x" + strings.Repeat("c", 64)
			} else {
				v.ID = "different-receipt-id"
			}
			if _, err = s.acceptSettlement(second, m, v); err == nil {
				t.Fatal("already claimed legacy receipt/transaction paid another invoice")
			}
			s.store.View(func(data Snapshot) error {
				if data.Invoices[second.ID].Status != "pending" {
					t.Fatal("second invoice became paid")
				}
				return nil
			})
		})
	}
}

func TestSettlementColdReplayPreservesWalletProofAndRejectsReplacement(t *testing.T) {
	s, m, invoice, v := settlementClaimFixture(t)
	if _, err := s.acceptSettlement(invoice, m, v); err != nil {
		t.Fatal(err)
	}
	if err := s.store.Update(func(data *Snapshot) error {
		stored := data.Invoices[invoice.ID]
		stored.Settlement.IntentDigest = "original-wallet-digest"
		stored.Settlement.RequestNonce = "original-wallet-request"
		data.Invoices[invoice.ID] = stored
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(s.store.path, s.key)
	if err != nil {
		t.Fatal(err)
	}
	s.store = reopened
	replay, err := s.acceptSettlement(invoice, m, v)
	if err != nil || replay.Settlement.IntentDigest != "original-wallet-digest" || replay.Settlement.RequestNonce != "original-wallet-request" {
		t.Fatal("cold observation overwrote original wallet proof", err)
	}
	v.ID = "replacement-money-receipt"
	v.TransactionHash = "0x" + strings.Repeat("d", 64)
	if _, err = s.acceptSettlement(invoice, m, v); err == nil {
		t.Fatal("different settlement replaced original paid fact")
	}
}
