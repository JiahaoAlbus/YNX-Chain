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
	eventInvoiceID, eventSettlementID, eventPayoutAddress, eventPayer, eventTransactionHash := "", "", "", "", ""
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
		invoice := BFTPayInvoice{ID: objectID, Signer: tx.Signer, IntentID: intent.ID, Merchant: intent.Merchant, Amount: intent.Amount, Currency: "YNXT", Status: "issued", PayoutAddress: tx.Signer, DueAt: blockTime.Add(time.Duration(input.DueInHours) * time.Hour), CreatedAt: blockTime, PaymentLink: "/pay/checkout/" + objectID, IdempotencyKey: input.IdempotencyKey, RequestHash: input.RequestHash, BlockHeight: height, TxHash: txHash}
		invoice.AuditHash = payInvoiceAuditHash(invoice)
		state.payInvoices = insertPayRecord(state.payInvoices, invoice, func(v BFTPayInvoice) string { return v.ID })
	case ActionPayInvoiceSettle:
		var input PaySettlementPayload
		_ = json.Unmarshal(tx.Payload, &input)
		invoiceIndex, invoice, ok := findPayRecord(state.payInvoices, input.InvoiceID, func(v BFTPayInvoice) string { return v.ID })
		if !ok || invoice.Signer != tx.Signer || invoice.Merchant != input.Merchant || invoice.Status != "issued" {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay settlement invoice is missing, unauthorized, or not issued"))
		}
		if !validationOnly && blockTime.After(invoice.DueAt) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay settlement invoice is expired"))
		}
		if invoice.PayoutAddress == "" {
			invoice.PayoutAddress = invoice.Signer
		}
		for _, existing := range state.paySettlements {
			if existing.IntentID == invoice.IntentID {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay intent already has an authoritative settlement"))
			}
		}
		_, transfer, ok := findPayRecord(state.nativeTransfers, input.TransactionHash, func(v BFTNativeTransfer) string { return v.TransactionHash })
		if !ok || transfer.From != input.Payer || transfer.To != invoice.PayoutAddress || transfer.Amount != invoice.Amount || transfer.Fee != 1 || transfer.BlockHeight <= invoice.BlockHeight || transfer.CommittedAt.IsZero() || transfer.CommittedAt.Before(invoice.CreatedAt) || (!validationOnly && transfer.CommittedAt.After(blockTime)) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay settlement transfer is not a matching committed native payment"))
		}
		if payTransferClaimed(state, input.TransactionHash) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay settlement transfer is already bound"))
		}
		objectID, objectType, eventType, amount = ApplicationActionRecordID("pay-settlement", txHash), "settlement", "invoice.paid", invoice.Amount
		settlement := BFTPaySettlement{ID: objectID, Signer: tx.Signer, IntentID: invoice.IntentID, InvoiceID: invoice.ID, Merchant: invoice.Merchant, PayoutAddress: invoice.PayoutAddress, Payer: input.Payer, Amount: invoice.Amount, Currency: invoice.Currency, TransactionHash: input.TransactionHash, Status: "paid", CreatedAt: blockTime, IdempotencyKey: input.IdempotencyKey, RequestHash: input.RequestHash, BlockHeight: height, TxHash: txHash}
		settlement.AuditHash = paySettlementAuditHash(settlement)
		state.paySettlements = insertPayRecord(state.paySettlements, settlement, func(v BFTPaySettlement) string { return v.ID })
		settledAt := blockTime
		invoice.Status, invoice.Payer, invoice.SettlementID, invoice.TransactionHash, invoice.SettledAt = "paid", input.Payer, settlement.ID, input.TransactionHash, &settledAt
		invoice.AuditHash = payInvoiceAuditHash(invoice)
		state.payInvoices[invoiceIndex] = invoice
		if intentIndex, intent, exists := findPayRecord(state.payIntents, invoice.IntentID, func(v BFTPayIntent) string { return v.ID }); exists {
			intent.Status = "paid"
			intent.AuditHash = payIntentAuditHash(intent)
			state.payIntents[intentIndex] = intent
		}
		eventInvoiceID, eventSettlementID, eventPayoutAddress, eventPayer, eventTransactionHash = invoice.ID, settlement.ID, invoice.PayoutAddress, input.Payer, input.TransactionHash
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
	case ActionPayRefundComplete:
		var input PayRefundCompletionPayload
		_ = json.Unmarshal(tx.Payload, &input)
		refundIndex, refund, ok := findPayRecord(state.payRefunds, input.RefundID, func(v BFTPayRefund) string { return v.ID })
		if !ok || refund.Signer != tx.Signer || refund.Merchant != input.Merchant || refund.Status != "recorded" {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay refund is missing, unauthorized, or not recorded"))
		}
		settlementIndex, settlement, ok := paidSettlementForIntent(state.paySettlements, refund.IntentID)
		if !ok || settlement.Signer != tx.Signer || settlement.Merchant != refund.Merchant || (settlement.Status != "paid" && settlement.Status != "partially_refunded") {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay refund requires one authoritative paid settlement"))
		}
		_, transfer, ok := findPayRecord(state.nativeTransfers, input.TransactionHash, func(v BFTNativeTransfer) string { return v.TransactionHash })
		if !ok || transfer.From != settlement.PayoutAddress || transfer.To != settlement.Payer || transfer.Amount != refund.Amount || transfer.Fee != 1 || transfer.BlockHeight <= refund.BlockHeight || transfer.BlockHeight <= settlement.BlockHeight || transfer.CommittedAt.Before(refund.CreatedAt) || transfer.CommittedAt.Before(settlement.CreatedAt) || (!validationOnly && transfer.CommittedAt.After(blockTime)) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay refund transfer is not a matching committed native refund"))
		}
		if payTransferClaimed(state, input.TransactionHash) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay refund transfer is already bound"))
		}
		var completed int64
		for _, existing := range state.payRefunds {
			if existing.IntentID == refund.IntentID && existing.Status == "completed" {
				if existing.Amount > math.MaxInt64-completed {
					return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("completed Pay refund total overflow"))
				}
				completed += existing.Amount
			}
		}
		if refund.Amount > settlement.Amount-completed {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Pay refund exceeds remaining paid settlement amount"))
		}
		objectID, objectType, eventType, amount = refund.ID, "refund", "refund.completed", refund.Amount
		completedAt := blockTime
		refund.InvoiceID, refund.SettlementID, refund.PayoutAddress, refund.Payer = settlement.InvoiceID, settlement.ID, settlement.PayoutAddress, settlement.Payer
		refund.Status, refund.TransactionHash, refund.CompletedAt = "completed", input.TransactionHash, &completedAt
		refund.CompletionIdempotencyKey, refund.CompletionRequestHash = input.IdempotencyKey, input.RequestHash
		refund.CompletionBlockHeight, refund.CompletionTxHash = height, txHash
		refund.AuditHash = payRefundAuditHash(refund)
		state.payRefunds[refundIndex] = refund
		completed += refund.Amount
		status := "partially_refunded"
		if completed == settlement.Amount {
			status = "refunded"
		}
		settlement.Status = status
		settlement.AuditHash = paySettlementAuditHash(settlement)
		state.paySettlements[settlementIndex] = settlement
		if invoiceIndex, invoice, exists := findPayRecord(state.payInvoices, settlement.InvoiceID, func(v BFTPayInvoice) string { return v.ID }); exists {
			invoice.Status = status
			invoice.AuditHash = payInvoiceAuditHash(invoice)
			state.payInvoices[invoiceIndex] = invoice
		}
		if intentIndex, intent, exists := findPayRecord(state.payIntents, refund.IntentID, func(v BFTPayIntent) string { return v.ID }); exists {
			intent.Status = status
			intent.AuditHash = payIntentAuditHash(intent)
			state.payIntents[intentIndex] = intent
		}
		eventInvoiceID, eventSettlementID, eventPayoutAddress, eventPayer, eventTransactionHash = settlement.InvoiceID, settlement.ID, settlement.PayoutAddress, settlement.Payer, input.TransactionHash
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
		case ActionPayInvoiceSettle:
			var p PaySettlementPayload
			_ = json.Unmarshal(tx.Payload, &p)
			_, invoice, _ := findPayRecord(state.payInvoices, p.InvoiceID, func(v BFTPayInvoice) string { return v.ID })
			intentID = invoice.IntentID
		case ActionPayRefundCreate:
			var p PayRefundPayload
			_ = json.Unmarshal(tx.Payload, &p)
			intentID = p.IntentID
		case ActionPayRefundComplete:
			var p PayRefundCompletionPayload
			_ = json.Unmarshal(tx.Payload, &p)
			_, refund, _ := findPayRecord(state.payRefunds, p.RefundID, func(v BFTPayRefund) string { return v.ID })
			intentID = refund.IntentID
		case ActionPayWebhookRecord:
			var p PayWebhookPayload
			_ = json.Unmarshal(tx.Payload, &p)
			intentID = p.IntentID
		}
	}
	event := BFTPayEvent{ID: ApplicationActionRecordID("pay-event", txHash), Type: eventType, IntentID: intentID, InvoiceID: eventInvoiceID, SettlementID: eventSettlementID, ObjectID: objectID, Signer: tx.Signer, Merchant: merchant, PayoutAddress: eventPayoutAddress, Payer: eventPayer, TransactionHash: eventTransactionHash, Amount: amount, Currency: "YNXT", IdempotencyKey: idempotencyKey, BlockHeight: height, TxHash: txHash, CreatedAt: blockTime}
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
	case ActionPayInvoiceSettle:
		var p PaySettlementPayload
		err = json.Unmarshal(tx.Payload, &p)
		return p.Merchant, p.IdempotencyKey, p.RequestHash, err
	case ActionPayRefundCreate:
		var p PayRefundPayload
		err = json.Unmarshal(tx.Payload, &p)
		return p.Merchant, p.IdempotencyKey, p.RequestHash, err
	case ActionPayRefundComplete:
		var p PayRefundCompletionPayload
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

func paidSettlementForIntent(values []BFTPaySettlement, intentID string) (int, BFTPaySettlement, bool) {
	index := -1
	var settlement BFTPaySettlement
	for candidateIndex, candidate := range values {
		if candidate.IntentID != intentID {
			continue
		}
		if index != -1 {
			return -1, BFTPaySettlement{}, false
		}
		index, settlement = candidateIndex, candidate
	}
	return index, settlement, index != -1
}

func payTransferClaimed(state executionState, transactionHash string) bool {
	for _, settlement := range state.paySettlements {
		if settlement.TransactionHash == transactionHash {
			return true
		}
	}
	for _, refund := range state.payRefunds {
		if refund.TransactionHash == transactionHash {
			return true
		}
	}
	return false
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
func paySettlementAuditHash(v BFTPaySettlement) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_PAY_SETTLEMENT_AUDIT_V1", v)
}
func payWebhookAuditHash(v BFTPayWebhook) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_PAY_WEBHOOK_AUDIT_V1", v)
}
func payEventAuditHash(v BFTPayEvent) string {
	return BFTPayEventAuditHash(v)
}

func BFTPayEventAuditHash(v BFTPayEvent) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_PAY_EVENT_AUDIT_V1", v)
}
