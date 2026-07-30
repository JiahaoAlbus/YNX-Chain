package datafabricpayledger

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

func TestReceiptAndRefundJournalMappingsPreserveAccountingTruth(t *testing.T) {
	at := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
	receiptEvent, receiptPayload := payLedgerEvent(t, "pay.receipt.issued", 25, at)
	receipt, err := receiptJournal(receiptEvent, receiptPayload, at.Add(-time.Second), at.Add(time.Second))
	if err != nil {
		t.Fatalf("build receipt journal: %v", err)
	}
	if receipt.FeeConsent == nil || !receipt.FeeConsent.AcceptedAt.Equal(at.Add(-time.Second)) || receipt.FeeConsent.MaximumAmountMinor != 25 || receipt.Postings[0].Side != datafabric.Debit || receipt.Postings[0].Category != "user-charge" || receipt.Postings[1].Side != datafabric.Credit || receipt.Postings[1].Category != "merchant-net" {
		t.Fatalf("receipt journal lost signed payment authority: %+v", receipt)
	}

	partialEvent, partialPayload := payLedgerEvent(t, "pay.refund.completed", 5, at.Add(2*time.Second))
	partial, correction, err := buildRefundJournal(receipt, partialEvent, partialPayload, at.Add(3*time.Second))
	if err != nil {
		t.Fatalf("build partial refund journal: %v", err)
	}
	if correction || partial.CorrectionOf != "" || partial.Postings[0].Category != "refund" || partial.Postings[0].Side != datafabric.Debit || partial.Postings[1].Side != datafabric.Credit {
		t.Fatalf("partial refund was falsely represented as an exact correction: %+v", partial)
	}

	fullEvent, fullPayload := payLedgerEvent(t, "pay.refund.completed", 25, at.Add(4*time.Second))
	full, correction, err := buildRefundJournal(receipt, fullEvent, fullPayload, at.Add(5*time.Second))
	if err != nil {
		t.Fatalf("build full refund correction: %v", err)
	}
	if !correction || full.CorrectionOf != receipt.EntryID {
		t.Fatalf("full refund did not use immutable correction history: %+v", full)
	}
	if err := datafabric.ValidateJournalCorrection(receipt, full); err != nil {
		t.Fatalf("full refund is not an exact validated reversal: %v", err)
	}
}

func TestPayLedgerPayloadRejectsRecordedRefundAndEnvelopeContradiction(t *testing.T) {
	at := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
	event, payload := payLedgerEvent(t, "pay.refund.completed", 5, at)
	payload.Status = "recorded"
	event.Payload, _ = json.Marshal(payload)
	if _, err := decodePayPayload(event); err == nil || !strings.Contains(err.Error(), "not completed") {
		t.Fatalf("recorded refund was accepted as completed: %v", err)
	}
	event, _ = payLedgerEvent(t, "pay.refund.completed", 5, at)
	event.Actor.AccountID = "account.other.0001"
	if _, err := decodePayPayload(event); err == nil || !strings.Contains(err.Error(), "contradicts") {
		t.Fatalf("envelope/payload contradiction was accepted: %v", err)
	}
}

func TestRefundRejectsReceiptJournalWithContradictoryAccounts(t *testing.T) {
	at := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
	receiptEvent, receiptPayload := payLedgerEvent(t, "pay.receipt.issued", 25, at)
	receipt, err := receiptJournal(receiptEvent, receiptPayload, at.Add(-time.Second), at)
	if err != nil {
		t.Fatalf("build receipt journal: %v", err)
	}
	receipt.Postings[1].AccountID = "account.pay.merchant.contradictory"

	refundEvent, refundPayload := payLedgerEvent(t, "pay.refund.completed", 5, at.Add(time.Second))
	if _, _, err := buildRefundJournal(receipt, refundEvent, refundPayload, at.Add(2*time.Second)); err == nil || !strings.Contains(err.Error(), "accounts are inconsistent") {
		t.Fatalf("refund accepted contradictory receipt journal accounts: %v", err)
	}
}

func payLedgerEvent(t *testing.T, eventType string, amount int64, at time.Time) (datafabric.EventEnvelope, payPayload) {
	t.Helper()
	status := "receipt-issued"
	settlementID := ""
	objectID := "settlement.pay.0001"
	if eventType == "pay.refund.completed" {
		status = "completed"
		settlementID = "settlement.pay.0001"
		objectID = "refund.pay.0001"
	}
	payload := payPayload{
		Status: status, SourceEventID: "source.pay.event.0001", SourceAuditHash: strings.Repeat("a", 64),
		InvoiceID: "invoice.pay.0001", SettlementID: settlementID, ObjectID: objectID,
		Merchant: "merchant.pay.0001", Payer: "account.payer.0001", PayoutAddress: "ynx_merchant_payout",
		TransactionHash: "0x" + strings.Repeat("b", 64), AmountMinor: amount, Currency: "YNXT",
		IdempotencyKeyRef: "idempotency.pay.0001",
	}
	encoded, _ := json.Marshal(payload)
	event := datafabric.EventEnvelope{
		EventID: derivedID("event.pay.ledger.", eventType+at.String()), EventType: eventType,
		SchemaVersion: datafabric.EnvelopeSchemaVersion, Product: "pay", Service: "invoice",
		AggregateID: payload.InvoiceID, Actor: datafabric.Actor{ActorID: "actor.pay.0001", AccountID: payload.Payer},
		CorrelationID: "correlation.pay.0001", Sequence: 1, Timestamp: at, EffectiveAt: at,
		SourceCommit: strings.Repeat("c", 40), SourceRelease: "pay-ledger-test",
		PrivacyClassification: "confidential", RetentionClass: "financial-7y",
		AuditID: derivedID("audit.pay.ledger.", eventType+at.String()),
		Source: datafabric.SourceMetadata{
			Source: "ynx-chain-pay-events", AsOf: at, Version: "pay-ledger-test", Status: "authoritative",
		},
		Payload: encoded,
	}
	return event, payload
}
