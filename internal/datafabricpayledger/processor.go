package datafabricpayledger

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricpostgres"
)

const ConsumerName = "pay-ledger-reconciliation-v1"

type TransferAuthority struct {
	From            string
	To              string
	TransactionHash string
	AmountMinor     int64
	Currency        string
	EffectiveAt     time.Time
}

type ChainObserver interface {
	ObserveTransfer(context.Context, TransferAuthority) (datafabric.SettlementObservation, error)
}

type Processor struct {
	Store    *datafabricpostgres.Store
	Observer ChainObserver
	Now      func() time.Time
}

type payPayload struct {
	Status            string `json:"status"`
	SourceEventID     string `json:"sourceEventId"`
	SourceAuditHash   string `json:"sourceAuditHash"`
	InvoiceID         string `json:"invoiceId"`
	SettlementID      string `json:"settlementId"`
	ObjectID          string `json:"objectId"`
	Merchant          string `json:"merchant"`
	Payer             string `json:"payer"`
	PayoutAddress     string `json:"payoutAddress"`
	TransactionHash   string `json:"transactionHash"`
	AmountMinor       int64  `json:"amountMinor"`
	Currency          string `json:"currency"`
	IdempotencyKeyRef string `json:"idempotencyKeyRef"`
}

func (p *Processor) Process(ctx context.Context, published datafabric.EventEnvelope) (bool, error) {
	if p == nil || p.Store == nil {
		return false, errors.New("Pay Ledger processor store is required")
	}
	if published.EventType != "pay.receipt.issued" && published.EventType != "pay.refund.completed" {
		return false, nil
	}
	authoritative, exists, err := p.Store.Event(ctx, published.EventID)
	if err != nil {
		return false, err
	}
	if !exists || authoritative.Integrity.Digest != published.Integrity.Digest || authoritative.EventType != published.EventType {
		return false, errors.New("published Pay event contradicts the authoritative event store")
	}
	applied, err := p.Store.ProjectionApplied(ctx, ConsumerName, published.EventID)
	if err != nil {
		return false, err
	}
	if applied {
		return false, nil
	}
	payload, err := decodePayPayload(authoritative)
	if err != nil {
		return false, err
	}
	if p.Observer == nil {
		return false, errors.New("Pay Ledger projection requires an independent chain observer")
	}
	from, to := payload.Payer, payload.PayoutAddress
	if authoritative.EventType == "pay.refund.completed" {
		from, to = payload.PayoutAddress, payload.Payer
	}
	chainObservation, err := p.Observer.ObserveTransfer(ctx, TransferAuthority{
		From: from, To: to, TransactionHash: payload.TransactionHash,
		AmountMinor: payload.AmountMinor, Currency: payload.Currency, EffectiveAt: authoritative.EffectiveAt,
	})
	if err != nil {
		return false, fmt.Errorf("observe Pay chain authority: %w", err)
	}
	if err := validateChainObservation(chainObservation, authoritative, payload); err != nil {
		return false, err
	}
	now := time.Now().UTC()
	if p.Now != nil {
		now = p.Now().UTC()
	}
	if now.Before(authoritative.EffectiveAt) || now.Before(chainObservation.ObservedAt) {
		return false, errors.New("Pay Ledger projection clock predates authoritative evidence")
	}
	return p.Store.ApplyProjection(ctx, ConsumerName, published.EventID, func(ctx context.Context, tx *sql.Tx, stored datafabric.EventEnvelope) (string, error) {
		if stored.Integrity.Digest != published.Integrity.Digest || stored.EventType != published.EventType {
			return "", errors.New("published Pay event contradicts the authoritative event store")
		}
		switch stored.EventType {
		case "pay.receipt.issued":
			entry, err := receiptJournal(stored, payload, chainObservation.ObservedAt, now)
			if err != nil {
				return "", err
			}
			if err := datafabricpostgres.PostJournalTx(ctx, tx, entry); err != nil {
				return "", err
			}
			return effectHash(entry.EntryID, stored.Integrity.Digest), nil
		case "pay.refund.completed":
			entry, correction, err := refundJournal(ctx, tx, stored, payload, now)
			if err != nil {
				return "", err
			}
			if correction {
				err = datafabricpostgres.PostCorrectionTx(ctx, tx, entry)
			} else {
				err = datafabricpostgres.PostJournalTx(ctx, tx, entry)
			}
			if err != nil {
				return "", err
			}
			payObservation := datafabric.SettlementObservation{
				Source: "pay", ReferenceID: payload.ObjectID, Asset: payload.Currency, Currency: payload.Currency,
				AmountMinor: payload.AmountMinor, ObservedAt: stored.EffectiveAt,
				Metadata: datafabric.SourceMetadata{
					Source: "ynx-pay-refund-completion", AsOf: stored.Source.AsOf,
					Version: stored.SourceRelease, Status: "authoritative",
				},
				EvidenceHash: payload.SourceAuditHash,
			}
			runID := derivedID("reconcile.pay.refund.", stored.EventID)
			auditID := derivedID("audit.pay.refund-reconcile.", stored.EventID)
			run, err := datafabricpostgres.ReconcileJournalTx(ctx, tx, runID, entry.EntryID, auditID, stored.SourceCommit, stored.SourceRelease, []string{"chain", "pay"}, []datafabric.SettlementObservation{chainObservation, payObservation}, now)
			if err != nil {
				return "", err
			}
			if run.Status != "matched" || run.Coverage != 1 {
				return "", errors.New("Pay refund reconciliation did not match both authoritative sources")
			}
			return effectHash(entry.EntryID, run.RunID, stored.Integrity.Digest), nil
		default:
			return "", errors.New("unsupported Pay Ledger event")
		}
	})
}

func decodePayPayload(event datafabric.EventEnvelope) (payPayload, error) {
	if event.Product != "pay" || event.Service != "invoice" || event.Actor.AccountID == "" || event.EffectiveAt.IsZero() || event.EffectiveAt.Location() != time.UTC {
		return payPayload{}, errors.New("Pay Ledger event authority is incomplete")
	}
	decoder := json.NewDecoder(bytes.NewReader(event.Payload))
	var payload payPayload
	if err := decoder.Decode(&payload); err != nil {
		return payPayload{}, fmt.Errorf("decode Pay Ledger payload: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return payPayload{}, errors.New("Pay Ledger payload contains trailing JSON")
	}
	if payload.SourceEventID == "" || !validEvidenceHash(payload.SourceAuditHash) || payload.InvoiceID == "" || payload.ObjectID == "" || payload.Merchant == "" || payload.Payer == "" || payload.PayoutAddress == "" || payload.TransactionHash == "" || payload.AmountMinor <= 0 || payload.Currency == "" {
		return payPayload{}, errors.New("Pay Ledger payload financial authority is incomplete")
	}
	if event.AggregateID != payload.InvoiceID || event.Actor.AccountID != payload.Payer {
		return payPayload{}, errors.New("Pay Ledger payload contradicts envelope authority")
	}
	switch event.EventType {
	case "pay.receipt.issued":
		if payload.Status != "receipt-issued" {
			return payPayload{}, errors.New("Pay receipt status is not issued")
		}
	case "pay.refund.completed":
		if payload.Status != "completed" || payload.SettlementID == "" {
			return payPayload{}, errors.New("Pay refund status is not completed")
		}
	default:
		return payPayload{}, errors.New("unsupported Pay Ledger event type")
	}
	return payload, nil
}

func receiptJournal(event datafabric.EventEnvelope, payload payPayload, acceptedAt, recordedAt time.Time) (datafabric.JournalEntry, error) {
	entry := datafabric.JournalEntry{
		EntryID: derivedID("journal.pay.receipt.", payload.InvoiceID), CorrelationID: event.CorrelationID,
		EventID: event.EventID, EffectiveAt: event.EffectiveAt, RecordedAt: recordedAt,
		Description: "Authoritative YNX Pay receipt", RevenueBoundary: "committed-native-payment",
		Postings: []datafabric.Posting{
			{AccountID: payload.Payer, Asset: payload.Currency, Currency: payload.Currency, Side: datafabric.Debit, Amount: payload.AmountMinor, Category: "user-charge"},
			{AccountID: merchantAccount(payload.PayoutAddress), Asset: payload.Currency, Currency: payload.Currency, Side: datafabric.Credit, Amount: payload.AmountMinor, Category: "merchant-net"},
		},
		SourceCommit: event.SourceCommit, SourceRelease: event.SourceRelease,
		AuditID: derivedID("audit.pay.receipt-ledger.", event.EventID),
		FeeConsent: &datafabric.FeeConsent{
			ConsentID: derivedID("consent.pay.transfer.", payload.TransactionHash), FeeScheduleVersion: "ynx-native-transfer-v1",
			AcceptedAt: acceptedAt, MaximumAmountMinor: payload.AmountMinor, Basis: "signed committed native transfer",
		},
	}
	return entry, entry.Validate()
}

func refundJournal(ctx context.Context, tx *sql.Tx, event datafabric.EventEnvelope, payload payPayload, recordedAt time.Time) (datafabric.JournalEntry, bool, error) {
	originalID := derivedID("journal.pay.receipt.", payload.InvoiceID)
	original, exists, err := datafabricpostgres.JournalEntryTx(ctx, tx, originalID)
	if err != nil {
		return datafabric.JournalEntry{}, false, err
	}
	if !exists {
		return datafabric.JournalEntry{}, false, errors.New("refund Ledger projection requires the authoritative receipt journal")
	}
	return buildRefundJournal(original, event, payload, recordedAt)
}

func buildRefundJournal(original datafabric.JournalEntry, event datafabric.EventEnvelope, payload payPayload, recordedAt time.Time) (datafabric.JournalEntry, bool, error) {
	if err := validateReceiptJournal(original, event, payload); err != nil {
		return datafabric.JournalEntry{}, false, err
	}
	originalAmount := debitAmount(original)
	if originalAmount <= 0 || payload.AmountMinor > originalAmount {
		return datafabric.JournalEntry{}, false, errors.New("refund exceeds authoritative receipt journal")
	}
	entry := datafabric.JournalEntry{
		EntryID: derivedID("journal.pay.refund.", event.EventID), CorrelationID: event.CorrelationID,
		EventID: event.EventID, EffectiveAt: event.EffectiveAt, RecordedAt: recordedAt,
		Description: "Authoritative completed YNX Pay refund", RevenueBoundary: "committed-native-refund",
		SourceCommit: event.SourceCommit, SourceRelease: event.SourceRelease,
		AuditID: derivedID("audit.pay.refund-ledger.", event.EventID),
	}
	if payload.AmountMinor == originalAmount {
		entry.CorrectionOf = original.EntryID
		entry.Postings = reversePostings(original.Postings)
	} else {
		entry.Postings = []datafabric.Posting{
			{AccountID: merchantAccount(payload.PayoutAddress), Asset: payload.Currency, Currency: payload.Currency, Side: datafabric.Debit, Amount: payload.AmountMinor, Category: "refund"},
			{AccountID: payload.Payer, Asset: payload.Currency, Currency: payload.Currency, Side: datafabric.Credit, Amount: payload.AmountMinor, Category: "refund"},
		}
	}
	return entry, entry.CorrectionOf != "", entry.Validate()
}

func validateReceiptJournal(original datafabric.JournalEntry, refundEvent datafabric.EventEnvelope, payload payPayload) error {
	if original.EntryID != derivedID("journal.pay.receipt.", payload.InvoiceID) || original.CorrectionOf != "" || original.CorrelationID != refundEvent.CorrelationID || len(original.Postings) != 2 {
		return errors.New("authoritative receipt journal identity is inconsistent")
	}
	wantMerchant := merchantAccount(payload.PayoutAddress)
	var payerDebit, merchantCredit bool
	for _, posting := range original.Postings {
		if posting.Asset != payload.Currency || posting.Currency != payload.Currency {
			return errors.New("authoritative receipt journal asset is inconsistent")
		}
		if posting.Side == datafabric.Debit && posting.AccountID == payload.Payer && posting.Category == "user-charge" {
			payerDebit = true
		}
		if posting.Side == datafabric.Credit && posting.AccountID == wantMerchant && posting.Category == "merchant-net" {
			merchantCredit = true
		}
	}
	if !payerDebit || !merchantCredit {
		return errors.New("authoritative receipt journal accounts are inconsistent")
	}
	return nil
}

func reversePostings(postings []datafabric.Posting) []datafabric.Posting {
	reversed := make([]datafabric.Posting, len(postings))
	for index, posting := range postings {
		posting.Side = datafabric.Debit
		if postings[index].Side == datafabric.Debit {
			posting.Side = datafabric.Credit
		}
		reversed[index] = posting
	}
	return reversed
}

func debitAmount(entry datafabric.JournalEntry) int64 {
	var amount int64
	for _, posting := range entry.Postings {
		if posting.Side == datafabric.Debit {
			amount += posting.Amount
		}
	}
	return amount
}

func merchantAccount(value string) string {
	return derivedID("account.pay.merchant.", value)
}

func derivedID(prefix, value string) string {
	digest := sha256.Sum256([]byte(value))
	return prefix + hex.EncodeToString(digest[:12])
}

func effectHash(parts ...string) string {
	digest := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(digest[:])
}

func validEvidenceHash(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

func validateChainObservation(observation datafabric.SettlementObservation, event datafabric.EventEnvelope, payload payPayload) error {
	if observation.Source != "chain" || observation.ReferenceID != payload.TransactionHash || observation.Asset != payload.Currency || observation.Currency != payload.Currency || observation.AmountMinor != payload.AmountMinor || observation.ObservedAt.IsZero() || observation.ObservedAt.Location() != time.UTC || observation.ObservedAt.After(event.EffectiveAt) || observation.Metadata.Status != "authoritative" || observation.Metadata.Source != "ynx-chain-committed-transaction" || !validEvidenceHash(observation.EvidenceHash) {
		return errors.New("independent chain observation contradicts canonical Pay authority")
	}
	return nil
}
