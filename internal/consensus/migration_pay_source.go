package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// LegacyPaySource is an immutable source-format import, not BFTPay records.
// Original IDs, HMAC results, time domains and paid/refund-status semantics are
// retained. No signer, action receipt, fee, nonce or request hash is invented.
// SourceAnchor binds the supplied migration, not an independent trusted root.
type LegacyPaySource struct {
	SourceAnchor string                            `json:"sourceAnchor"`
	Intents      map[string]chain.PayIntent        `json:"intents"`
	Invoices     map[string]chain.Invoice          `json:"invoices"`
	Settlements  map[string]chain.PaySettlement    `json:"settlements"`
	Refunds      map[string]chain.RefundRecord     `json:"refunds"`
	Webhooks     map[string]chain.WebhookSignature `json:"webhooks"`
	Events       map[string]chain.PayEvent         `json:"events"`
}

// SourcePayAuthorityRequirement describes unavailable source authority rather
// than granting it. An opaque merchant name, an optional destination, a payment
// sender and a public audit hash are not an authenticated merchant principal.
type SourcePayAuthorityRequirement struct {
	IntentID      string `json:"intentId"`
	Merchant      string `json:"merchant"`
	PayoutAddress string `json:"payoutAddress,omitempty"`
	Reason        string `json:"reason"`
}

func migrationPaySource(m chain.ConsensusMigrationState) *LegacyPaySource {
	r := m.Runtime
	if r == nil || len(r.PayIntents)+len(r.Invoices)+len(r.PaySettlements)+len(r.Refunds)+len(r.Webhooks)+len(r.PayEvents) == 0 {
		return nil
	}
	return cloneLegacyPaySource(&LegacyPaySource{SourceAnchor: m.StateHash, Intents: r.PayIntents,
		Invoices: r.Invoices, Settlements: r.PaySettlements, Refunds: r.Refunds, Webhooks: r.Webhooks, Events: r.PayEvents})
}

func cloneSourcePayMap[T any](input map[string]T) map[string]T {
	if input == nil {
		return nil
	}
	out := make(map[string]T, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func cloneLegacyPaySource(input *LegacyPaySource) *LegacyPaySource {
	if input == nil {
		return nil
	}
	out := &LegacyPaySource{SourceAnchor: input.SourceAnchor, Intents: cloneSourcePayMap(input.Intents),
		Invoices: cloneSourcePayMap(input.Invoices), Settlements: cloneSourcePayMap(input.Settlements),
		Refunds: cloneSourcePayMap(input.Refunds), Webhooks: cloneSourcePayMap(input.Webhooks), Events: cloneSourcePayMap(input.Events)}
	for id, value := range out.Refunds {
		if value.CompletedAt != nil {
			completed := *value.CompletedAt
			value.CompletedAt = &completed
			out.Refunds[id] = value
		}
	}
	return out
}

// No source Pay mutation stored its caller signature. Even an address-shaped
// Merchant or a proved payment cannot remove this requirement. A future
// binding must be independently authorized and explicitly scoped to this
// source anchor and original intent; self-asserted mapping is insufficient.
func sourcePayAuthorityRequirements(source *LegacyPaySource) []SourcePayAuthorityRequirement {
	if source == nil {
		return nil
	}
	result := make([]SourcePayAuthorityRequirement, 0, len(source.Intents))
	for id, intent := range source.Intents {
		result = append(result, SourcePayAuthorityRequirement{IntentID: id, Merchant: intent.Merchant,
			PayoutAddress: intent.PayoutAddress,
			Reason:        "original merchant mutation has no signed principal/action; independent source-anchored merchant binding is required; retained webhook HMAC does not prove its secret or merchant authority"})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].IntentID < result[j].IntentID })
	return result
}

// validateLegacyPaySource proves source-format consistency and preservation.
// It does NOT clear the execution blocker or authorize future Pay mutations.
// The caller must first validate and independently trust the complete migration.
// Native transfers can lack recoverable signed wire, so matching original block
// history is evidence of the source checkpoint, never a fabricated BFT signature.
func validateLegacyPaySource(source *LegacyPaySource, current CommittedState, m chain.ConsensusMigrationState) error {
	if !reflect.DeepEqual(source, migrationPaySource(m)) {
		return errors.New("source Pay differs from the complete migration checkpoint")
	}
	if source == nil {
		return nil
	}
	if current.Version < 18 {
		return errors.New("source Pay requires committed state version 18 or later")
	}
	if m.Runtime == nil || source.SourceAnchor == "" {
		return errors.New("source Pay requires the complete anchored runtime")
	}
	if err := validateSourcePayRecords(source, m); err != nil {
		return err
	}
	// A later native BFT record cannot replace or claim an imported source ID or
	// consume a transfer already used by a source settlement/refund.
	ids := make(map[string]struct{})
	claims := make(map[string]struct{})
	for id := range source.Intents {
		ids[id] = struct{}{}
	}
	for id := range source.Invoices {
		ids[id] = struct{}{}
	}
	for id, value := range source.Settlements {
		ids[id] = struct{}{}
		claims[value.TransactionHash] = struct{}{}
	}
	for id, value := range source.Refunds {
		ids[id] = struct{}{}
		if value.Status == "completed" {
			claims[value.TransactionHash] = struct{}{}
		}
	}
	for id := range source.Webhooks {
		ids[id] = struct{}{}
	}
	for id := range source.Events {
		ids[id] = struct{}{}
	}
	check := func(id, transfer string) error {
		if _, exists := ids[id]; exists {
			return errors.New("BFT Pay record shadows a source object")
		}
		if _, exists := claims[transfer]; transfer != "" && exists {
			return errors.New("BFT Pay record reuses a source payment or refund")
		}
		return nil
	}
	for _, value := range current.PayIntents {
		if err := check(value.ID, ""); err != nil {
			return err
		}
	}
	for _, value := range current.PayInvoices {
		for _, id := range []string{value.ID, value.IntentID, value.SettlementID} {
			if err := check(id, value.TransactionHash); err != nil {
				return err
			}
		}
	}
	for _, value := range current.PaySettlements {
		for _, id := range []string{value.ID, value.IntentID, value.InvoiceID} {
			if err := check(id, value.TransactionHash); err != nil {
				return err
			}
		}
	}
	for _, value := range current.PayRefunds {
		for _, id := range []string{value.ID, value.IntentID, value.InvoiceID, value.SettlementID} {
			if err := check(id, value.TransactionHash); err != nil {
				return err
			}
		}
	}
	for _, value := range current.PayWebhooks {
		for _, id := range []string{value.EventID, value.IntentID} {
			if err := check(id, ""); err != nil {
				return err
			}
		}
	}
	for _, value := range current.PayEvents {
		for _, id := range []string{value.ID, value.IntentID, value.InvoiceID, value.SettlementID, value.ObjectID} {
			if err := check(id, value.TransactionHash); err != nil {
				return err
			}
		}
	}
	for _, value := range current.PayIdempotency {
		for _, id := range []string{value.ID, value.ObjectID} {
			if err := check(id, ""); err != nil {
				return err
			}
		}
	}
	return nil
}

func sourcePayAddress(value string) (string, error) {
	canonical, err := accountaddress.Normalize(value)
	if err != nil {
		return "", err
	}
	native, err := accountaddress.Encode(canonical)
	if err != nil || native != value {
		return "", errors.New("source Pay address is not the original native encoding")
	}
	return canonical, nil
}

func sourcePayHash(parts ...string) string {
	h := sha256.New()
	for _, part := range parts {
		_, _ = h.Write([]byte(part))
		_, _ = h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func sourcePaySettlementAudit(v chain.PaySettlement) string {
	return sourcePayHash("pay-settlement-audit", v.ID, v.IntentID, v.InvoiceID, v.Merchant, v.PayoutAddress, v.Payer,
		strconv.FormatInt(v.Amount, 10), v.Currency, v.TransactionHash, strconv.FormatUint(v.BlockNumber, 10), v.Status,
		v.IdempotencyKey, v.CreatedAt.Format(time.RFC3339Nano))
}

func sourcePayRefundAudit(v chain.RefundRecord) string {
	completed := ""
	if v.CompletedAt != nil {
		completed = v.CompletedAt.UTC().Format(time.RFC3339Nano)
	}
	return sourcePayHash("pay-refund-audit", v.ID, v.IntentID, v.InvoiceID, v.SettlementID, v.Merchant, v.PayoutAddress, v.Payer,
		strconv.FormatInt(v.Amount, 10), v.Currency, v.Reason, v.Status, v.TransactionHash, strconv.FormatUint(v.BlockNumber, 10),
		v.IdempotencyKey, v.CompletionIdempotencyKey, v.CreatedAt.Format(time.RFC3339Nano), completed)
}

func sourcePayEvent(kind, intent, object, merchant string, amount int64, currency, key string, at time.Time) chain.PayEvent {
	return chain.PayEvent{ID: sourcePayHash("pay-event", kind, intent, object, key, strconv.FormatInt(at.UnixNano(), 10))[:24],
		Type: kind, IntentID: intent, ObjectID: object, Merchant: merchant, Amount: amount, Currency: currency, IdempotencyKey: key, CreatedAt: at}
}

func sourcePayEventAudit(v chain.PayEvent) string {
	parts := []string{"pay-event-audit", v.Type, v.IntentID}
	if v.InvoiceID != "" {
		parts = append(parts, v.InvoiceID)
	}
	if v.Type == "refund.completed" {
		parts = append(parts, v.SettlementID)
	}
	parts = append(parts, v.ObjectID, v.Merchant)
	if v.Type == "invoice.paid" || v.Type == "refund.completed" {
		parts = append(parts, v.PayoutAddress, v.Payer, v.TransactionHash)
	}
	parts = append(parts, strconv.FormatInt(v.Amount, 10), v.Currency, v.IdempotencyKey, v.CreatedAt.Format(time.RFC3339Nano))
	return sourcePayHash(parts...)
}

func validateSourcePayRecords(s *LegacyPaySource, m chain.ConsensusMigrationState) error {
	expectedEvents := make(map[string]chain.PayEvent)
	addEvent := func(v chain.PayEvent) error {
		v.AuditHash = sourcePayEventAudit(v)
		if _, exists := expectedEvents[v.ID]; exists {
			return errors.New("source Pay event identity collision")
		}
		expectedEvents[v.ID] = v
		return nil
	}
	// Legacy idempotency scopes are deliberately not flattened into BFT's
	// merchant-wide key domain. Empty keys were legal and mean no replay guard.
	type sourceScope struct{ kind, principal, secondary, key string }
	idempotency := make(map[sourceScope]struct{})
	unique := func(key string, scope ...string) error {
		if key == "" {
			return nil
		}
		if len(scope) < 2 || len(scope) > 3 {
			return errors.New("invalid source Pay idempotency scope")
		}
		value := sourceScope{kind: scope[0], principal: scope[1], key: key}
		if len(scope) == 3 {
			value.secondary = scope[2]
		}
		if _, exists := idempotency[value]; exists {
			return errors.New("source Pay idempotency scope collision")
		}
		idempotency[value] = struct{}{}
		return nil
	}
	for id, v := range s.Intents {
		if id != v.ID || !payIDPattern.MatchString(id) || strings.TrimSpace(v.Merchant) != v.Merchant || v.Merchant == "" || v.Amount <= 0 || v.Currency != m.Network.NativeCurrencySymbol || v.CreatedAt.IsZero() || (v.Status != "created" && v.Status != "paid") {
			return errors.New("source Pay intent is incomplete")
		}
		if v.PayoutAddress != "" {
			if _, err := sourcePayAddress(v.PayoutAddress); err != nil {
				return err
			}
		}
		if err := unique(v.IdempotencyKey, "intent", v.Merchant); err != nil {
			return err
		}
		if err := addEvent(sourcePayEvent("payment_intent.created", id, id, v.Merchant, v.Amount, v.Currency, v.IdempotencyKey, v.CreatedAt)); err != nil {
			return err
		}
	}
	for id, v := range s.Invoices {
		intent, exists := s.Intents[v.IntentID]
		if !exists || id != v.ID || !payIDPattern.MatchString(id) || v.Merchant != intent.Merchant || v.PayoutAddress != intent.PayoutAddress || v.Amount != intent.Amount || v.Currency != intent.Currency || v.CreatedAt.IsZero() || v.CreatedAt.Before(intent.CreatedAt) || !v.DueAt.After(v.CreatedAt) || v.PaymentLink != "/pay/checkout/"+id || (v.Status != "issued" && v.Status != "paid") {
			return errors.New("source Pay invoice contradicts its intent")
		}
		if err := unique(v.IdempotencyKey, "invoice", v.IntentID); err != nil {
			return err
		}
		event := sourcePayEvent("invoice.issued", v.IntentID, id, v.Merchant, v.Amount, v.Currency, v.IdempotencyKey, v.CreatedAt)
		event.InvoiceID = id
		if err := addEvent(event); err != nil {
			return err
		}
	}
	// Index only referenced transfers, once, without copying the full history.
	wanted := make(map[string]struct{})
	for _, v := range s.Settlements {
		wanted[v.TransactionHash] = struct{}{}
	}
	for _, v := range s.Refunds {
		if v.Status == "completed" {
			wanted[v.TransactionHash] = struct{}{}
		}
	}
	transfers := make(map[string]chain.Transaction, len(wanted))
	for _, block := range m.Runtime.Blocks {
		for _, tx := range block.Transactions {
			if _, needed := wanted[tx.Hash]; !needed {
				continue
			}
			if _, duplicate := transfers[tx.Hash]; duplicate || tx.BlockNum != block.Height || tx.BlockHash != block.Hash || tx.BlockNum == 0 || tx.BlockHash == "" {
				return errors.New("source Pay transfer has ambiguous block provenance")
			}
			transfers[tx.Hash] = tx
		}
	}
	claimed := make(map[string]string)
	claim := func(hash, from, to string, amount int64, height uint64, notBefore ...time.Time) error {
		tx, exists := transfers[hash]
		if !exists || !payNativeTransactionHashPattern.MatchString(hash) || tx.Type != "transfer" || tx.Fee != 1 || tx.Amount != amount || tx.BlockNum != height {
			return errors.New("source Pay transfer is not a matching committed native transfer")
		}
		fromCanonical, err := sourcePayAddress(from)
		if err != nil {
			return err
		}
		toCanonical, err := sourcePayAddress(to)
		if err != nil {
			return err
		}
		if tx.From != fromCanonical || tx.To != toCanonical {
			return errors.New("source Pay transfer direction differs from original payer/payout")
		}
		for _, at := range notBefore {
			if tx.Timestamp.Before(at) {
				return errors.New("source Pay transfer predates its original authority")
			}
		}
		if _, exists := claimed[hash]; exists {
			return errors.New("source Pay transfer is claimed more than once")
		}
		claimed[hash] = from
		return nil
	}
	settledInvoices, paidIntents := make(map[string]bool), make(map[string]bool)
	for id, v := range s.Settlements {
		invoice, exists := s.Invoices[v.InvoiceID]
		// Native expiry used an earlier wall-clock read, not CreatedAt. Do not
		// invent an exact persisted expiry-check instant at the deadline boundary.
		if !exists || id != v.ID || id != sourcePayHash("pay-settlement", v.InvoiceID, v.Payer, v.TransactionHash)[:24] || v.IntentID != invoice.IntentID || v.Merchant != invoice.Merchant || v.PayoutAddress != invoice.PayoutAddress || v.PayoutAddress == "" || v.Amount != invoice.Amount || v.Currency != invoice.Currency || v.Status != "paid" || v.CreatedAt.IsZero() || v.CreatedAt.Before(invoice.CreatedAt) || v.IdempotencyKey == "" || len(v.IdempotencyKey) > 128 || v.AuditHash != sourcePaySettlementAudit(v) || settledInvoices[v.InvoiceID] {
			return errors.New("source Pay settlement contradicts original invoice or audit")
		}
		if err := claim(v.TransactionHash, v.Payer, v.PayoutAddress, v.Amount, v.BlockNumber, invoice.CreatedAt); err != nil {
			return err
		}
		if err := unique(v.IdempotencyKey, "settlement", v.InvoiceID, v.Payer); err != nil {
			return err
		}
		settledInvoices[v.InvoiceID], paidIntents[v.IntentID] = true, true
		event := sourcePayEvent("invoice.paid", v.IntentID, id, v.Merchant, v.Amount, v.Currency, v.IdempotencyKey, v.CreatedAt)
		event.InvoiceID, event.PayoutAddress, event.Payer, event.TransactionHash = v.InvoiceID, v.PayoutAddress, v.Payer, v.TransactionHash
		if err := addEvent(event); err != nil {
			return err
		}
	}
	reserved, completed, completedInvoice := map[string]int64{}, map[string]int64{}, map[string]int64{}
	for id, v := range s.Refunds {
		intent, exists := s.Intents[v.IntentID]
		if !exists || id != v.ID || !payIDPattern.MatchString(id) || v.Amount <= 0 || v.Amount > intent.Amount-reserved[v.IntentID] || v.Currency != intent.Currency || v.CreatedAt.IsZero() || v.CreatedAt.Before(intent.CreatedAt) || (v.Status != "recorded" && v.Status != "completed") {
			return errors.New("source Pay refund is incomplete or exceeds reserved intent amount")
		}
		reserved[v.IntentID] += v.Amount // subtraction above also prevents overflow.
		if err := unique(v.IdempotencyKey, "refund", v.IntentID); err != nil {
			return err
		}
		if err := addEvent(sourcePayEvent("refund.recorded", v.IntentID, id, intent.Merchant, v.Amount, v.Currency, v.IdempotencyKey, v.CreatedAt)); err != nil {
			return err
		}
		if v.Status == "recorded" {
			if v.InvoiceID != "" || v.SettlementID != "" || v.Merchant != "" || v.PayoutAddress != "" || v.Payer != "" || v.TransactionHash != "" || v.BlockNumber != 0 || v.CompletedAt != nil || v.CompletionIdempotencyKey != "" || v.AuditHash != "" {
				return errors.New("uncompleted source Pay refund carries completion authority")
			}
			continue
		}
		settlement, exists := s.Settlements[v.SettlementID]
		if !exists || v.IntentID != settlement.IntentID || v.InvoiceID != settlement.InvoiceID || v.Merchant != settlement.Merchant || v.PayoutAddress != settlement.PayoutAddress || v.Payer != settlement.Payer || v.CompletedAt == nil || v.CompletedAt.Before(v.CreatedAt) || v.CompletedAt.Before(settlement.CreatedAt) || v.CompletionIdempotencyKey == "" || len(v.CompletionIdempotencyKey) > 128 || v.AuditHash != sourcePayRefundAudit(v) || v.Amount > settlement.Amount-completed[v.IntentID] {
			return errors.New("completed source Pay refund contradicts its original settlement")
		}
		settlementsAtCompletion := 0
		for _, candidate := range s.Settlements {
			if candidate.IntentID == v.IntentID && !candidate.CreatedAt.After(*v.CompletedAt) {
				settlementsAtCompletion++
			}
		}
		if settlementsAtCompletion != 1 {
			return errors.New("source Pay refund completion did not have one original paid settlement")
		}
		if err := claim(v.TransactionHash, v.PayoutAddress, v.Payer, v.Amount, v.BlockNumber, v.CreatedAt, settlement.CreatedAt); err != nil {
			return err
		}
		completed[v.IntentID] += v.Amount
		completedInvoice[v.InvoiceID] += v.Amount
		event := sourcePayEvent("refund.completed", v.IntentID, id, v.Merchant, v.Amount, v.Currency, v.CompletionIdempotencyKey, *v.CompletedAt)
		event.InvoiceID, event.SettlementID, event.PayoutAddress, event.Payer, event.TransactionHash = v.InvoiceID, v.SettlementID, v.PayoutAddress, v.Payer, v.TransactionHash
		if err := addEvent(event); err != nil {
			return err
		}
	}
	projection := func(status string, paid bool, refunded int64, refundStatus string, total, amount int64) error {
		if (status == "paid") != paid || refunded != total {
			return errors.New("source Pay paid/refunded projection differs from original records")
		}
		expected := ""
		if total > 0 {
			expected = "partially_refunded"
		}
		if total == amount {
			expected = "refunded"
		}
		if refundStatus != expected {
			return errors.New("source Pay refund status differs from completed transfers")
		}
		return nil
	}
	for id, v := range s.Intents {
		if err := projection(v.Status, paidIntents[id], v.RefundedAmount, v.RefundStatus, completed[id], v.Amount); err != nil {
			return err
		}
	}
	for id, v := range s.Invoices {
		if err := projection(v.Status, settledInvoices[id], v.RefundedAmount, v.RefundStatus, completedInvoice[id], v.Amount); err != nil {
			return err
		}
	}
	for id, v := range s.Webhooks {
		intent, exists := s.Intents[v.IntentID]
		payload := strings.Join([]string{v.EventID, v.IntentID, v.EventType, v.SignedAt.Format(time.RFC3339Nano)}, ".")
		if !exists || id != v.EventID || id != sourcePayHash("event", v.IntentID, v.EventType, strconv.FormatInt(v.SignedAt.UnixNano(), 10))[:24] || v.EventType == "" || v.SignedAt.IsZero() || v.SignedAt.Before(intent.CreatedAt) || v.Algorithm != "hmac-sha256" || !payHashPattern.MatchString(v.Signature) || v.PayloadHash != sourcePayHash("webhook-payload", payload) || v.ReplaySafe != (v.IdempotencyKey != "") {
			return errors.New("source Pay webhook material contradicts its original payload")
		}
		if err := unique(v.IdempotencyKey, "webhook", v.IntentID, v.EventType); err != nil {
			return err
		}
		if err := addEvent(sourcePayEvent("webhook.signed", v.IntentID, id, intent.Merchant, 0, intent.Currency, v.IdempotencyKey, v.SignedAt)); err != nil {
			return err
		}
	}
	if len(s.Events) != len(expectedEvents) {
		return errors.New("source Pay event inventory does not cover original mutations")
	}
	for id, expected := range expectedEvents {
		if actual, exists := s.Events[id]; !exists || !reflect.DeepEqual(actual, expected) {
			return fmt.Errorf("source Pay event does not match original mutation: %s", id)
		}
	}
	return nil
}
