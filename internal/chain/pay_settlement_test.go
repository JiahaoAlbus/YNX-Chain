package chain

import (
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

func TestPaySettlementBindsCommittedNativeTransferAndPersists(t *testing.T) {
	payer := "0x1111111111111111111111111111111111111111"
	merchant := "0x2222222222222222222222222222222222222222"
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
	intent, err := devnet.CreatePayIntentForPayoutWithIdempotency("merchant_checkout", merchantNative, 25, "", "intent-checkout")
	if err != nil {
		t.Fatal(err)
	}
	invoice, err := devnet.CreateInvoiceWithIdempotency(intent.ID, 12, "invoice-checkout")
	if err != nil {
		t.Fatal(err)
	}
	if invoice.PayoutAddress != merchantNative {
		t.Fatalf("invoice lost merchant payout binding: %+v", invoice)
	}
	tx, err := devnet.Transfer(payer, merchant, 25)
	if err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	settlement, err := devnet.SettleInvoice(invoice.ID, payerNative, tx.Hash, "settle-checkout")
	if err != nil {
		t.Fatal(err)
	}
	if settlement.Status != "paid" || settlement.Payer != payerNative || settlement.PayoutAddress != merchantNative || settlement.Amount != 25 || settlement.TransactionHash != tx.Hash || settlement.BlockNumber == 0 || len(settlement.AuditHash) != 64 {
		t.Fatalf("unexpected settlement: %+v", settlement)
	}
	paidInvoice, _ := devnet.Invoice(invoice.ID)
	paidIntent, _ := devnet.PayIntent(intent.ID)
	if paidInvoice.Status != "paid" || paidIntent.Status != "paid" {
		t.Fatalf("Pay objects did not transition to paid: %+v %+v", paidInvoice, paidIntent)
	}
	replayed, err := devnet.SettleInvoice(invoice.ID, payerNative, tx.Hash, "settle-checkout")
	if err != nil || replayed != settlement {
		t.Fatalf("exact settlement replay changed result: %+v %v", replayed, err)
	}
	if _, err := devnet.SettleInvoice(invoice.ID, payerNative, "0x"+strings.Repeat("a", 64), "settle-checkout"); err == nil || !strings.Contains(err.Error(), "different settlement transaction") {
		t.Fatalf("changed idempotency input was not rejected: %v", err)
	}

	reloaded, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	restored, ok := reloaded.PaySettlementByInvoice(invoice.ID)
	if !ok || restored != settlement {
		t.Fatalf("settlement did not survive restart: %+v %v", restored, ok)
	}
	events := reloaded.PayEvents(intent.ID)
	last := events[len(events)-1]
	if last.Type != "invoice.paid" || last.Payer != payerNative || last.PayoutAddress != merchantNative || last.TransactionHash != tx.Hash || len(last.AuditHash) != 64 {
		t.Fatalf("settlement event is incomplete: %+v", last)
	}
}

func TestPaySettlementRejectsUncommittedMismatchedAndReusedTransfers(t *testing.T) {
	payer := "0x3333333333333333333333333333333333333333"
	merchant := "0x4444444444444444444444444444444444444444"
	payerNative, _ := accountaddress.Encode(payer)
	merchantNative, _ := accountaddress.Encode(merchant)
	devnet := NewDevnet(DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(payer, 200); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	intent, _ := devnet.CreatePayIntentForPayoutWithIdempotency("merchant_bounds", merchantNative, 30, "", "intent-bounds")
	invoice, _ := devnet.CreateInvoiceWithIdempotency(intent.ID, 12, "invoice-bounds")
	pending, err := devnet.Transfer(payer, merchant, 30)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.SettleInvoice(invoice.ID, payerNative, pending.Hash, "settle-pending"); err == nil || !strings.Contains(err.Error(), "not committed") {
		t.Fatalf("pending transfer was accepted: %v", err)
	}
	devnet.ProduceBlock()
	wrongIntent, _ := devnet.CreatePayIntentForPayoutWithIdempotency("merchant_bounds", merchantNative, 31, "", "intent-wrong")
	wrongInvoice, _ := devnet.CreateInvoiceWithIdempotency(wrongIntent.ID, 12, "invoice-wrong")
	if _, err := devnet.SettleInvoice(wrongInvoice.ID, payerNative, pending.Hash, "settle-wrong"); err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("amount mismatch was accepted: %v", err)
	}
	if _, err := devnet.SettleInvoice(invoice.ID, payerNative, pending.Hash, "settle-valid"); err != nil {
		t.Fatal(err)
	}
	secondIntent, _ := devnet.CreatePayIntentForPayoutWithIdempotency("merchant_bounds", merchantNative, 30, "", "intent-reuse")
	secondInvoice, _ := devnet.CreateInvoiceWithIdempotency(secondIntent.ID, 12, "invoice-reuse")
	if _, err := devnet.SettleInvoice(secondInvoice.ID, payerNative, pending.Hash, "settle-reuse"); err == nil || !strings.Contains(err.Error(), "already bound") {
		t.Fatalf("transaction reuse was accepted: %v", err)
	}
	if _, err := devnet.CreatePayIntentForPayoutWithIdempotency("merchant_bounds", "not-an-address", 1, "", "bad-payout"); err == nil || !strings.Contains(err.Error(), "invalid payoutAddress") {
		t.Fatalf("invalid payout address was accepted: %v", err)
	}
}
