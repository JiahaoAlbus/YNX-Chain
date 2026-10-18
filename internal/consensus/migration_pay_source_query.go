package consensus

import (
	"bytes"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

type legacyPayProvenance struct {
	Source        string `json:"source"`
	SourceAnchor  string `json:"sourceAnchor"`
	Authorization string `json:"authorization"`
	Writable      bool   `json:"writable"`
	MutationFence string `json:"mutationFence"`
}

func sourcePayProvenance(anchor string) legacyPayProvenance {
	return legacyPayProvenance{Source: "source_import", SourceAnchor: anchor,
		Authorization: "historical_claim_only", Writable: false, MutationFence: "signed_merchant_binding_missing"}
}

type sourcePayIntentView struct {
	chain.PayIntent
	legacyPayProvenance
}
type sourcePayInvoiceView struct {
	chain.Invoice
	legacyPayProvenance
}
type sourcePaySettlementView struct {
	chain.PaySettlement
	legacyPayProvenance
}
type sourcePayRefundView struct {
	chain.RefundRecord
	legacyPayProvenance
}
type sourcePayWebhookView struct {
	chain.WebhookSignature
	legacyPayProvenance
}
type sourcePayEventView struct {
	chain.PayEvent
	legacyPayProvenance
}

// Query receives validated committed state under the application's read lock.
// The source anchor identifies the original import, not Comet inclusion or an
// independent proof. Original paid/refund fields and MAC bytes are unchanged;
// no absent signing key, merchant binding or BFT action receipt is invented.
// State validation rejects cross-source ID shadowing before this merged view.
func queryLegacyPaySource(response *abcitypes.ResponseQuery, path string, source *LegacyPaySource, state CommittedState) bool {
	if path == "/pay/source" {
		if source == nil {
			response.Value = []byte("null")
			return true
		}
		response.Value, _ = json.Marshal(struct {
			legacyPayProvenance
			Records *LegacyPaySource `json:"records"`
		}{sourcePayProvenance(source.SourceAnchor), source})
		return true
	}
	if path == "/pay/source/authority-requirements" {
		response.Value, _ = json.Marshal(sourcePayAuthorityRequirements(source))
		return true
	}
	if source == nil {
		return false
	}
	provenance := sourcePayProvenance(source.SourceAnchor)
	switch {
	case strings.HasPrefix(path, "/pay/intents/"):
		id := strings.TrimPrefix(path, "/pay/intents/")
		if value, ok := source.Intents[id]; ok {
			response.Key = []byte(id)
			response.Value, _ = json.Marshal(sourcePayIntentView{value, provenance})
			return true
		}
	case strings.HasPrefix(path, "/pay/invoices/"):
		id := strings.TrimPrefix(path, "/pay/invoices/")
		if value, ok := source.Invoices[id]; ok {
			response.Key = []byte(id)
			response.Value, _ = json.Marshal(sourcePayInvoiceView{value, provenance})
			return true
		}
	case strings.HasPrefix(path, "/pay/settlements/"):
		id := strings.TrimPrefix(path, "/pay/settlements/")
		if value, ok := source.Settlements[id]; ok {
			response.Key = []byte(id)
			response.Value, _ = json.Marshal(sourcePaySettlementView{value, provenance})
			return true
		}
	case strings.HasPrefix(path, "/pay/refunds/"):
		id := strings.TrimPrefix(path, "/pay/refunds/")
		if value, ok := source.Refunds[id]; ok {
			response.Key = []byte(id)
			response.Value, _ = json.Marshal(sourcePayRefundView{value, provenance})
			return true
		}
	case strings.HasPrefix(path, "/pay/webhooks/"):
		id := strings.TrimPrefix(path, "/pay/webhooks/")
		if value, ok := source.Webhooks[id]; ok {
			response.Key = []byte(id)
			response.Value, _ = json.Marshal(sourcePayWebhookView{value, provenance})
			return true
		}
	case strings.HasPrefix(path, "/pay/events/"):
		id := strings.TrimPrefix(path, "/pay/events/")
		if value, ok := source.Events[id]; ok {
			response.Key = []byte(id)
			response.Value, _ = json.Marshal(sourcePayEventView{value, provenance})
			return true
		}
	case path == "/pay/events":
		type item struct {
			id    string
			value any
		}
		items := make([]item, 0, len(source.Events)+len(state.PayEvents))
		for id, value := range source.Events {
			items = append(items, item{id, sourcePayEventView{value, provenance}})
		}
		for _, value := range state.PayEvents {
			items = append(items, item{value.ID, value})
		}
		sort.Slice(items, func(i, j int) bool { return items[i].id < items[j].id })
		values := make([]any, len(items))
		for i, item := range items {
			values[i] = item.value
		}
		response.Value, _ = json.Marshal(values)
		return true
	}
	// A missing source ID continues to the existing BFT query, preserving its
	// normal result/not-found contract. No source idempotency record is forged.
	return false
}

// The caller must first verify the actual signed action and account policy.
// This additional fence runs BEFORE fee/nonce/resource mutation. It cannot
// authenticate an original merchant: even the original payer/payout signer is
// not entitled to adopt a source object. Unrelated new BFT objects remain legal.
func rejectLegacyPayActionWrite(source *LegacyPaySource, tx SignedApplicationAction, txHash string) error {
	if source == nil || !isPayAction(tx.Action) {
		return nil
	}
	canonical, err := canonicalPayActionPayload(tx.Action, tx.Payload)
	if err != nil {
		return err
	}
	if !bytes.Equal(canonical, tx.Payload) {
		return errors.New("noncanonical Pay payload at source boundary")
	}
	merchant, key, _, err := payActionIdentity(tx)
	if err != nil {
		return err
	}
	ids := []string{ApplicationActionRecordID("pay-event", txHash), PayIdempotencyID(merchant, key)}
	transfer := ""
	switch tx.Action {
	case ActionPayIntentCreate:
		ids = append(ids, ApplicationActionRecordID("pay-intent", txHash))
	case ActionPayInvoiceCreate:
		var p PayInvoicePayload
		_ = json.Unmarshal(tx.Payload, &p)
		ids = append(ids, p.IntentID, ApplicationActionRecordID("pay-invoice", txHash))
	case ActionPayInvoiceSettle:
		var p PaySettlementPayload
		_ = json.Unmarshal(tx.Payload, &p)
		ids = append(ids, p.InvoiceID, ApplicationActionRecordID("pay-settlement", txHash))
		transfer = p.TransactionHash
	case ActionPayRefundCreate:
		var p PayRefundPayload
		_ = json.Unmarshal(tx.Payload, &p)
		ids = append(ids, p.IntentID, ApplicationActionRecordID("pay-refund", txHash))
	case ActionPayRefundComplete:
		var p PayRefundCompletionPayload
		_ = json.Unmarshal(tx.Payload, &p)
		ids = append(ids, p.RefundID)
		transfer = p.TransactionHash
	case ActionPayWebhookRecord:
		var p PayWebhookPayload
		_ = json.Unmarshal(tx.Payload, &p)
		ids = append(ids, p.IntentID, p.EventID)
	}
	for _, id := range ids {
		_, intent := source.Intents[id]
		_, invoice := source.Invoices[id]
		_, settlement := source.Settlements[id]
		_, refund := source.Refunds[id]
		_, webhook := source.Webhooks[id]
		_, event := source.Events[id]
		if intent || invoice || settlement || refund || webhook || event {
			return errors.New("source Pay object is immutable without independently authorized merchant binding")
		}
	}
	if transfer != "" {
		for _, value := range source.Settlements {
			if value.TransactionHash == transfer {
				return errors.New("Pay transfer was already consumed by an original source settlement")
			}
		}
		for _, value := range source.Refunds {
			if value.Status == "completed" && value.TransactionHash == transfer {
				return errors.New("Pay transfer was already consumed by an original source refund")
			}
		}
	}
	return nil
}
