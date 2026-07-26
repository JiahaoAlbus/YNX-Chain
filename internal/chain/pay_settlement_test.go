package chain

import (
	"fmt"
	"strings"
	"testing"
	"time"

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
	if last.Type != "invoice.paid" || last.InvoiceID != invoice.ID || last.Payer != payerNative || last.PayoutAddress != merchantNative || last.TransactionHash != tx.Hash || len(last.AuditHash) != 64 {
		t.Fatalf("settlement event is incomplete: %+v", last)
	}
}

func TestEnsureStateDefaultsEnrichesLegacyPayEventInvoiceBinding(t *testing.T) {
	payer := "0x5555555555555555555555555555555555555555"
	merchant := "0x6666666666666666666666666666666666666666"
	payerNative, _ := accountaddress.Encode(payer)
	merchantNative, _ := accountaddress.Encode(merchant)
	devnet := NewDevnet(DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(payer, 100); err != nil {
		t.Fatalf("fund payer: %v", err)
	}
	devnet.ProduceBlock()
	intent, err := devnet.CreatePayIntentForPayoutWithIdempotency("legacy-pay-merchant", merchantNative, 25, "", "legacy-intent")
	if err != nil {
		t.Fatalf("create intent: %v", err)
	}
	invoice, err := devnet.CreateInvoiceWithIdempotency(intent.ID, 24, "legacy-invoice")
	if err != nil {
		t.Fatalf("create invoice: %v", err)
	}
	tx, err := devnet.Transfer(payer, merchant, 25)
	if err != nil {
		t.Fatalf("submit payment: %v", err)
	}
	devnet.ProduceBlock()
	settlement, err := devnet.SettleInvoice(invoice.ID, payerNative, tx.Hash, "legacy-settlement")
	if err != nil {
		t.Fatalf("settle invoice: %v", err)
	}

	for id, event := range devnet.payEvents {
		if event.Type != "invoice.issued" && event.Type != "invoice.paid" {
			continue
		}
		event.InvoiceID = ""
		if event.Type == "invoice.paid" {
			event.AuditHash = hashParts("pay-event-audit", event.Type, event.IntentID, event.ObjectID, event.Merchant, event.PayoutAddress, event.Payer, event.TransactionHash, fmt.Sprint(event.Amount), event.Currency, event.IdempotencyKey, event.CreatedAt.Format(time.RFC3339Nano))
		} else {
			event.AuditHash = hashParts("pay-event-audit", event.Type, event.IntentID, event.ObjectID, event.Merchant, fmt.Sprint(event.Amount), event.Currency, event.IdempotencyKey, event.CreatedAt.Format(time.RFC3339Nano))
		}
		devnet.payEvents[id] = event
	}

	devnet.ensureStateDefaults()
	for _, event := range devnet.PayEvents(intent.ID) {
		if event.Type != "invoice.issued" && event.Type != "invoice.paid" {
			continue
		}
		if event.InvoiceID != invoice.ID {
			t.Fatalf("legacy %s event invoice binding = %q, want %q", event.Type, event.InvoiceID, invoice.ID)
		}
		if event.AuditHash != payEventAuditHash(event) {
			t.Fatalf("legacy %s event audit hash was not migrated", event.Type)
		}
	}
	if settlement.InvoiceID != invoice.ID {
		t.Fatalf("settlement invoice binding = %q, want %q", settlement.InvoiceID, invoice.ID)
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
