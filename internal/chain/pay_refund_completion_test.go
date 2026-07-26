package chain

import (
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

func TestRefundCompletionBindsCommittedReverseTransferAndPersists(t *testing.T) {
	payer := "0x7777777777777777777777777777777777777777"
	merchant := "0x8888888888888888888888888888888888888888"
	payerNative, _ := accountaddress.Encode(payer)
	merchantNative, _ := accountaddress.Encode(merchant)
	dir := t.TempDir()
	devnet, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet(payer, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	intent, err := devnet.CreatePayIntentForPayoutWithIdempotency("merchant.refund.0001", merchantNative, 25, "", "refund-intent")
	if err != nil {
		t.Fatal(err)
	}
	invoice, err := devnet.CreateInvoiceWithIdempotency(intent.ID, 12, "refund-invoice")
	if err != nil {
		t.Fatal(err)
	}
	payment, err := devnet.Transfer(payer, merchant, 25)
	if err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	settlement, err := devnet.SettleInvoice(invoice.ID, payerNative, payment.Hash, "refund-settlement")
	if err != nil {
		t.Fatal(err)
	}
	refund, err := devnet.CreateRefundWithIdempotency(intent.ID, 5, "partial customer refund", "refund-request")
	if err != nil {
		t.Fatal(err)
	}
	reverse, err := devnet.Transfer(merchant, payer, 5)
	if err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	completed, err := devnet.CompleteRefund(refund.ID, reverse.Hash, "refund-completion")
	if err != nil {
		t.Fatal(err)
	}
	if completed.Status != "completed" || completed.InvoiceID != invoice.ID || completed.SettlementID != settlement.ID || completed.Payer != payerNative || completed.PayoutAddress != merchantNative || completed.TransactionHash != reverse.Hash || completed.BlockNumber == 0 || completed.CompletedAt == nil || completed.AuditHash != payRefundAuditHash(completed) {
		t.Fatalf("refund completion is incomplete: %+v", completed)
	}
	replayed, err := devnet.CompleteRefund(refund.ID, reverse.Hash, "refund-completion")
	if err != nil || replayed.AuditHash != completed.AuditHash {
		t.Fatalf("exact refund completion replay changed authority: %+v %v", replayed, err)
	}
	if _, err := devnet.CompleteRefund(refund.ID, reverse.Hash, "different-completion"); err == nil || !strings.Contains(err.Error(), "already completed") {
		t.Fatalf("changed refund completion replay was accepted: %v", err)
	}
	updatedIntent, _ := devnet.PayIntent(intent.ID)
	updatedInvoice, _ := devnet.Invoice(invoice.ID)
	if updatedIntent.Status != "paid" || updatedInvoice.Status != "paid" || updatedIntent.RefundStatus != "partially_refunded" || updatedInvoice.RefundStatus != "partially_refunded" || updatedIntent.RefundedAmount != 5 || updatedInvoice.RefundedAmount != 5 {
		t.Fatalf("refund status was not projected to Pay authority: %+v %+v", updatedIntent, updatedInvoice)
	}
	if _, err := devnet.SettleInvoice(invoice.ID, payerNative, payment.Hash, "second-settlement"); err == nil || !strings.Contains(err.Error(), "already paid") {
		t.Fatalf("refund projection reopened paid invoice settlement: %v", err)
	}

	reloaded, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	restored, ok := reloaded.Refund(refund.ID)
	if !ok || restored.AuditHash != completed.AuditHash || restored.TransactionHash != reverse.Hash {
		t.Fatalf("refund completion did not survive restart: %+v %v", restored, ok)
	}
	events := reloaded.PayEvents(intent.ID)
	last := events[len(events)-1]
	if last.Type != "refund.completed" || last.InvoiceID != invoice.ID || last.SettlementID != settlement.ID || last.ObjectID != refund.ID || last.TransactionHash != reverse.Hash || last.AuditHash != payEventAuditHash(last) {
		t.Fatalf("refund completion event is incomplete: %+v", last)
	}
}

func TestRefundCompletionRejectsUncommittedAndMismatchedTransfers(t *testing.T) {
	payer := "0x9999999999999999999999999999999999999999"
	merchant := "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	payerNative, _ := accountaddress.Encode(payer)
	merchantNative, _ := accountaddress.Encode(merchant)
	devnet := NewDevnet(DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(payer, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	intent, _ := devnet.CreatePayIntentForPayoutWithIdempotency("merchant.refund.0002", merchantNative, 25, "", "reject-intent")
	invoice, _ := devnet.CreateInvoiceWithIdempotency(intent.ID, 12, "reject-invoice")
	payment, _ := devnet.Transfer(payer, merchant, 25)
	devnet.ProduceBlock()
	if _, err := devnet.SettleInvoice(invoice.ID, payerNative, payment.Hash, "reject-settlement"); err != nil {
		t.Fatal(err)
	}
	refund, _ := devnet.CreateRefundWithIdempotency(intent.ID, 5, "reject vectors", "reject-refund")
	pending, err := devnet.Transfer(merchant, payer, 5)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.CompleteRefund(refund.ID, pending.Hash, "pending-completion"); err == nil || !strings.Contains(err.Error(), "not committed") {
		t.Fatalf("uncommitted refund transfer was accepted: %v", err)
	}
	devnet.ProduceBlock()
	wrongAmount, err := devnet.Transfer(merchant, payer, 4)
	if err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	if _, err := devnet.CompleteRefund(refund.ID, wrongAmount.Hash, "wrong-completion"); err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("mismatched refund transfer was accepted: %v", err)
	}
}
