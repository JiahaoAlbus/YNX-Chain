package consensus

import (
	"encoding/json"
	"errors"
	"math"
	"sort"
	"time"

	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func (a *Application) applyPayAction(state executionState, raw []byte, tx SignedApplicationAction, height int64, blockTime time.Time, validationOnly bool) (executionState, transactionExecution, error) {
	txHash := ApplicationActionHash(raw)
	merchant, idempotencyKey, requestHash, err := payActionIdentity(tx)
	if err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	idempotencyID := PayIdempotencyID(merchant, idempotencyKey)
	if _, _, exists := findPayRecord(state.payIdempotency, idempotencyID, func(v BFTPayIdempotency) string { return v.ID }); exists {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay idempotency key is already committed"))
	}
	if err := a.chargeApplicationAction(&state, tx); err != nil {
		return executionState{}, transactionExecution{}, err
	}

	objectID, objectType, eventType := "", "", ""
	var amount int64
	switch tx.Action {
	case ActionPayIntentCreate:
		var input PayIntentPayload
		_ = json.Unmarshal(tx.Payload, &input)
		objectID, objectType, eventType, amount = ApplicationActionRecordID("pay-intent", txHash), "intent", "payment_intent.created", input.Amount
		intent := BFTPayIntent{ID: objectID, Signer: tx.Signer, Merchant: input.Merchant, Amount: input.Amount, Currency: "YNXT", Status: "created", CreatedAt: blockTime, CallbackURL: input.CallbackURL, IdempotencyKey: input.IdempotencyKey, RequestHash: input.RequestHash, BlockHeight: height, TxHash: txHash}
		intent.AuditHash = payIntentAuditHash(intent)
		state.payIntents = insertPayRecord(state.payIntents, intent, func(v BFTPayIntent) string { return v.ID })
	case ActionPayInvoiceCreate:
		var input PayInvoicePayload
		_ = json.Unmarshal(tx.Payload, &input)
		_, intent, ok := findPayRecord(state.payIntents, input.IntentID, func(v BFTPayIntent) string { return v.ID })
		if !ok || intent.Signer != tx.Signer || intent.Merchant != input.Merchant {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay invoice intent is missing or not owned by signer and merchant"))
		}
		objectID, objectType, eventType, amount = ApplicationActionRecordID("pay-invoice", txHash), "invoice", "invoice.issued", intent.Amount
		invoice := BFTPayInvoice{ID: objectID, Signer: tx.Signer, IntentID: intent.ID, Merchant: intent.Merchant, Amount: intent.Amount, Currency: "YNXT", Status: "issued", DueAt: blockTime.Add(time.Duration(input.DueInHours) * time.Hour), CreatedAt: blockTime, PaymentLink: "/pay/checkout/" + objectID, IdempotencyKey: input.IdempotencyKey, RequestHash: input.RequestHash, BlockHeight: height, TxHash: txHash}
		invoice.AuditHash = payInvoiceAuditHash(invoice)
		state.payInvoices = insertPayRecord(state.payInvoices, invoice, func(v BFTPayInvoice) string { return v.ID })
	case ActionPayRefundCreate:
		var input PayRefundPayload
		_ = json.Unmarshal(tx.Payload, &input)
		_, intent, ok := findPayRecord(state.payIntents, input.IntentID, func(v BFTPayIntent) string { return v.ID })
		if !ok || intent.Signer != tx.Signer || intent.Merchant != input.Merchant {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay refund intent is missing or not owned by signer and merchant"))
		}
		var refunded int64
		for _, existing := range state.payRefunds {
			if existing.IntentID == intent.ID {
				if existing.Amount > math.MaxInt64-refunded {
					return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay refund total overflow"))
				}
				refunded += existing.Amount
			}
		}
		if input.Amount > intent.Amount-refunded {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay refund exceeds remaining intent amount"))
		}
		objectID, objectType, eventType, amount = ApplicationActionRecordID("pay-refund", txHash), "refund", "refund.recorded", input.Amount
		refund := BFTPayRefund{ID: objectID, Signer: tx.Signer, Merchant: intent.Merchant, IntentID: intent.ID, Amount: input.Amount, Currency: "YNXT", Reason: input.Reason, Status: "recorded", CreatedAt: blockTime, IdempotencyKey: input.IdempotencyKey, RequestHash: input.RequestHash, BlockHeight: height, TxHash: txHash}
		refund.AuditHash = payRefundAuditHash(refund)
		state.payRefunds = insertPayRecord(state.payRefunds, refund, func(v BFTPayRefund) string { return v.ID })
	case ActionPayWebhookRecord:
		var input PayWebhookPayload
		_ = json.Unmarshal(tx.Payload, &input)
		_, intent, ok := findPayRecord(state.payIntents, input.IntentID, func(v BFTPayIntent) string { return v.ID })
		if !ok || intent.Signer != tx.Signer || intent.Merchant != input.Merchant {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay webhook intent is missing or not owned by signer and merchant"))
		}
		if !validationOnly {
			delta := blockTime.Sub(input.SignedAt)
			if delta < -10*time.Minute || delta > 10*time.Minute {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay webhook signedAt is outside the block-time window"))
			}
		}
		if _, _, exists := findPayRecord(state.payWebhooks, input.EventID, func(v BFTPayWebhook) string { return v.EventID }); exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay webhook event already exists"))
		}
		objectID, objectType, eventType = input.EventID, "webhook", "webhook.signed"
		webhook := BFTPayWebhook{EventID: input.EventID, Signer: tx.Signer, Merchant: intent.Merchant, IntentID: intent.ID, EventType: input.EventType, Signature: input.Signature, PayloadHash: input.PayloadHash, SignedAt: input.SignedAt, Algorithm: input.Algorithm, IdempotencyKey: input.IdempotencyKey, ReplaySafe: true, RequestHash: input.RequestHash, BlockHeight: height, TxHash: txHash}
		webhook.AuditHash = payWebhookAuditHash(webhook)
		state.payWebhooks = insertPayRecord(state.payWebhooks, webhook, func(v BFTPayWebhook) string { return v.EventID })
	default:
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unsupported Pay application action"))
	}

	intentID := objectID
	if tx.Action != ActionPayIntentCreate {
		switch tx.Action {
		case ActionPayInvoiceCreate:
			var p PayInvoicePayload
			_ = json.Unmarshal(tx.Payload, &p)
			intentID = p.IntentID
		case ActionPayRefundCreate:
			var p PayRefundPayload
			_ = json.Unmarshal(tx.Payload, &p)
			intentID = p.IntentID
		case ActionPayWebhookRecord:
			var p PayWebhookPayload
			_ = json.Unmarshal(tx.Payload, &p)
			intentID = p.IntentID
		}
	}
	event := BFTPayEvent{ID: ApplicationActionRecordID("pay-event", txHash), Type: eventType, IntentID: intentID, ObjectID: objectID, Signer: tx.Signer, Merchant: merchant, Amount: amount, Currency: "YNXT", IdempotencyKey: idempotencyKey, BlockHeight: height, TxHash: txHash, CreatedAt: blockTime}
	event.AuditHash = payEventAuditHash(event)
	state.payEvents = append(state.payEvents, event)
	idempotency := BFTPayIdempotency{ID: idempotencyID, Signer: tx.Signer, Merchant: merchant, IdempotencyKey: idempotencyKey, Action: tx.Action, RequestHash: requestHash, ObjectType: objectType, ObjectID: objectID, TxHash: txHash}
	state.payIdempotency = insertPayRecord(state.payIdempotency, idempotency, func(v BFTPayIdempotency) string { return v.ID })
	return state, transactionExecution{typeName: tx.Type, event: abcitypes.Event{Type: "ynx.pay_action", Attributes: []abcitypes.EventAttribute{{Key: "action", Value: tx.Action, Index: true}, {Key: "signer", Value: tx.Signer, Index: true}, {Key: "merchant", Value: merchant, Index: true}, {Key: "object_id", Value: objectID, Index: true}}}}, nil
}

func payActionIdentity(tx SignedApplicationAction) (merchant, key, requestHash string, err error) {
	switch tx.Action {
	case ActionPayIntentCreate:
		var p PayIntentPayload
		err = json.Unmarshal(tx.Payload, &p)
		return p.Merchant, p.IdempotencyKey, p.RequestHash, err
	case ActionPayInvoiceCreate:
		var p PayInvoicePayload
		err = json.Unmarshal(tx.Payload, &p)
		return p.Merchant, p.IdempotencyKey, p.RequestHash, err
	case ActionPayRefundCreate:
		var p PayRefundPayload
		err = json.Unmarshal(tx.Payload, &p)
		return p.Merchant, p.IdempotencyKey, p.RequestHash, err
	case ActionPayWebhookRecord:
		var p PayWebhookPayload
		err = json.Unmarshal(tx.Payload, &p)
		return p.Merchant, p.IdempotencyKey, p.RequestHash, err
	default:
		return "", "", "", errors.New("unsupported Pay action")
	}
}

func findPayRecord[T any](values []T, id string, idOf func(T) string) (int, T, bool) {
	index := sort.Search(len(values), func(i int) bool { return idOf(values[i]) >= id })
	var zero T
	if index < len(values) && idOf(values[index]) == id {
		return index, values[index], true
	}
	return index, zero, false
}
func insertPayRecord[T any](values []T, value T, idOf func(T) string) []T {
	index, _, _ := findPayRecord(values, idOf(value), idOf)
	values = append(values, value)
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}

func payIntentAuditHash(v BFTPayIntent) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_PAY_INTENT_AUDIT_V1", v)
}
func payInvoiceAuditHash(v BFTPayInvoice) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_PAY_INVOICE_AUDIT_V1", v)
}
func payRefundAuditHash(v BFTPayRefund) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_PAY_REFUND_AUDIT_V1", v)
}
func payWebhookAuditHash(v BFTPayWebhook) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_PAY_WEBHOOK_AUDIT_V1", v)
}
func payEventAuditHash(v BFTPayEvent) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_PAY_EVENT_AUDIT_V1", v)
}
