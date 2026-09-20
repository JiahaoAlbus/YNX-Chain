package finance

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
)

type BrokerDispatchClaim struct {
	Order       BrokerOrderRecord `json:"order"`
	Outbox      BrokerOrderOutbox `json:"outbox"`
	BlockedCode string            `json:"blockedCode,omitempty"`
}

func (s *Store) RequestBrokerExecution(account, orderID, idempotencyKey string, now time.Time) (BrokerOrderOutbox, error) {
	var result BrokerOrderOutbox
	if !idempotencyPattern.MatchString(idempotencyKey) {
		return result, errors.New("a canonical idempotency key is required")
	}
	err := s.updateBrokerCAS(account, "broker.execution.requested", orderID, func(state *AccountState) error {
		order, orderOK := state.Brokerage.Orders[orderID]
		outbox, outboxOK := state.Brokerage.Outbox[orderID]
		if !orderOK || !outboxOK || order.ApprovalState != "consumed" {
			return errors.New("consumed Broker outbox was not found")
		}
		if outbox.ExecutionRequestKey == idempotencyKey {
			result = outbox
			return errBrokerStateUnchanged
		}
		if outbox.ExecutionRequestKey != "" {
			return errors.New("Broker execution was already requested with another idempotency key")
		}
		if outbox.Status != "pending_unwired" || order.State != "submitting" || outbox.ProviderOrderID != "" || order.ProviderOrderID != "" {
			return errors.New("Broker order is not eligible for execution")
		}
		outbox.Status, outbox.ExecutionRequestKey, outbox.ExecutionRequestedAt, outbox.UpdatedAt = "execution_requested", idempotencyKey, now.UTC(), now.UTC()
		state.Brokerage.Outbox[orderID] = outbox
		appendBrokerJournal(&state.Brokerage, orderID, order.RequestID, "product.execution_requested", order.ApprovalState, order.State, now.UTC())
		result = outbox
		return nil
	})
	return result, err
}

func (s *Store) ClaimBrokerDispatch(account, orderID string, now time.Time) (BrokerDispatchClaim, error) {
	var result BrokerDispatchClaim
	err := s.updateBrokerCAS(account, "broker.outbox.claim", orderID, func(state *AccountState) error {
		normalizeBrokerageState(&state.Brokerage)
		order, orderOK := state.Brokerage.Orders[orderID]
		outbox, outboxOK := state.Brokerage.Outbox[orderID]
		if !orderOK || !outboxOK || order.ApprovalState != "consumed" {
			return errors.New("consumed Broker outbox was not found")
		}
		if outbox.ProviderOrderID != "" || order.ProviderOrderID != "" || outbox.Status == "submitted" || outbox.Status == "submitted_unknown" || outbox.Status == "provider_rejected" || outbox.Status == "execution_blocked" || order.State == "submitted" || order.State == "submitted_unknown" || order.State == "partially_filled" || order.State == "filled" || order.State == "cancel_requested" || order.State == "canceled" || order.State == "provider_rejected" || order.State == "provider_expired" || order.State == "execution_blocked" {
			return errors.New("Broker outbox is terminal or provider-correlated and is not dispatchable")
		}
		if outbox.Status == "dispatching" {
			return errors.New("Broker outbox is already claimed")
		}
		if outbox.Status != "execution_requested" {
			return fmt.Errorf("Broker outbox cannot dispatch from %s", outbox.Status)
		}
		challenge, challengeOK := state.Brokerage.Challenges[order.RequestID]
		mapping := state.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
		expiresAt, expiresErr := parseFinanceMilliseconds(challenge.Unsigned.ExpiresAt)
		blocked := ""
		if !challengeOK || expiresErr != nil || !now.UTC().Before(expiresAt) {
			blocked = "ORDER_APPROVAL_EXPIRED"
		} else if mapping.Status != "active" || mapping.Account != account || mapping.SubjectID != order.SubjectID || mapping.BrokerAccountID != order.BrokerAccountID {
			blocked = "ACCOUNT_MAPPING_CHANGED"
		}
		if blocked != "" {
			outbox.Status, outbox.LastErrorCode, outbox.UpdatedAt = "execution_blocked", blocked, now.UTC()
			order.State, order.UpdatedAt = "execution_blocked", now.UTC()
			state.Brokerage.Outbox[orderID], state.Brokerage.Orders[orderID] = outbox, order
			appendBrokerJournal(&state.Brokerage, orderID, order.RequestID, "product.execution_blocked", order.ApprovalState, order.State, now.UTC())
			result = BrokerDispatchClaim{Order: order, Outbox: outbox, BlockedCode: blocked}
			return nil
		}
		outbox.Status, outbox.Attempts, outbox.UpdatedAt = "dispatching", outbox.Attempts+1, now.UTC()
		order.State, order.UpdatedAt = "submitting", now.UTC()
		state.Brokerage.Outbox[orderID], state.Brokerage.Orders[orderID] = outbox, order
		appendBrokerJournal(&state.Brokerage, orderID, order.RequestID, "provider.dispatch_claimed", order.ApprovalState, order.State, now.UTC())
		result = BrokerDispatchClaim{Order: order, Outbox: outbox}
		return nil
	})
	return result, err
}

func brokerLocalExecutionBlock(code string) bool {
	return code == "ORDER_APPROVAL_EXPIRED" || code == "ACCOUNT_MAPPING_CHANGED"
}

func (s *Store) CompleteBrokerDispatch(account, orderID string, providerOrder *brokerage.Order, providerError error, now time.Time) (BrokerOrderRecord, error) {
	var result BrokerOrderRecord
	err := s.updateBrokerCAS(account, "broker.outbox.complete", orderID, func(state *AccountState) error {
		order, orderOK := state.Brokerage.Orders[orderID]
		outbox, outboxOK := state.Brokerage.Outbox[orderID]
		if !orderOK || !outboxOK || outbox.Status != "dispatching" {
			return errors.New("Broker outbox claim is not active")
		}
		action := "provider.submitted"
		if providerError == nil && providerOrder != nil {
			if providerOrder.ClientOrderID != outbox.ProviderClientOrderID || providerOrder.AssetID != order.Order.AssetID || providerOrder.Symbol != order.Order.Symbol || providerOrder.Side != order.Order.Side || providerOrder.Qty != order.Order.Qty {
				return errors.New("provider order does not match the signed Finance order")
			}
			order.State, order.ProviderOrderID = normalizeBrokerOrderState(providerOrder.Status), providerOrder.ID
			order.ProviderRawStatus, order.ProviderHTTPRequestID = providerOrder.Status, providerOrder.RequestID
			outbox.Status, outbox.ProviderOrderID, outbox.ProviderRawStatus, outbox.ProviderHTTPRequestID, outbox.LastErrorCode = brokerOutboxStatus(order.State), providerOrder.ID, providerOrder.Status, providerOrder.RequestID, brokerOutboxError(order.State)
			if order.State == "provider_rejected" {
				action = "provider.submission_rejected"
			}
		} else {
			code := brokerage.ErrorCode(providerError)
			providerRequestID := brokerage.ErrorRequestID(providerError)
			outbox.LastErrorCode, outbox.ProviderHTTPRequestID, order.ProviderHTTPRequestID = code, providerRequestID, providerRequestID
			if code == "ORDER_SUBMISSION_DISABLED" || code == "BROKER_NOT_CONFIGURED" || code == "ACCOUNT_NOT_LINKED" || code == "ORDER_REQUEST_INVALID" || code == "ORDER_PREFLIGHT_FAILED" {
				outbox.Status, order.State, action = "execution_requested", "submitting", "provider.dispatch_not_attempted"
			} else if code == "PROVIDER_UNAVAILABLE" || code == "PROVIDER_PROTOCOL_ERROR" {
				outbox.Status, order.State, action = "submitted_unknown", "submitted_unknown", "provider.submission_unknown"
			} else if code == "PROVIDER_REJECTED" {
				if providerRequestID == "" {
					outbox.LastErrorCode = "PROVIDER_PROTOCOL_ERROR"
					outbox.Status, order.State, action = "submitted_unknown", "submitted_unknown", "provider.submission_unknown"
				} else {
					outbox.Status, order.State, action = "provider_rejected", "provider_rejected", "provider.submission_rejected"
				}
			} else {
				outbox.Status, order.State, action = "provider_rejected", "provider_rejected", "provider.submission_rejected"
			}
		}
		outbox.UpdatedAt, order.UpdatedAt = now.UTC(), now.UTC()
		state.Brokerage.Outbox[orderID], state.Brokerage.Orders[orderID] = outbox, order
		appendBrokerJournal(&state.Brokerage, orderID, order.RequestID, action, order.ApprovalState, order.State, now.UTC(), BrokerProviderAudit{RawStatus: order.ProviderRawStatus, HTTPRequestID: order.ProviderHTTPRequestID})
		result = order
		return nil
	})
	return result, err
}

func (s *Store) RecoverInterruptedBrokerDispatches(account string, now time.Time) error {
	return s.updateBrokerCAS(account, "broker.outbox.restart_recovery", "", func(state *AccountState) error {
		changed := false
		for orderID, outbox := range state.Brokerage.Outbox {
			if outbox.Status != "dispatching" {
				continue
			}
			order := state.Brokerage.Orders[orderID]
			outbox.Status, outbox.LastErrorCode, outbox.UpdatedAt = "submitted_unknown", "PROCESS_RESTART_DURING_DISPATCH", now.UTC()
			order.State, order.UpdatedAt = "submitted_unknown", now.UTC()
			state.Brokerage.Outbox[orderID], state.Brokerage.Orders[orderID] = outbox, order
			appendBrokerJournal(&state.Brokerage, orderID, order.RequestID, "provider.restart_unknown", order.ApprovalState, order.State, now.UTC())
			changed = true
		}
		if !changed {
			return errBrokerStateUnchanged
		}
		return nil
	})
}

func (s *Store) RequestBrokerCancel(account, orderID string, now time.Time) (BrokerOrderRecord, error) {
	var result BrokerOrderRecord
	err := s.updateBrokerCAS(account, "broker.cancel.requested", orderID, func(state *AccountState) error {
		order, ok := state.Brokerage.Orders[orderID]
		if ok && order.ProviderOrderID != "" && order.State == "cancel_requested" {
			result = order
			return errBrokerStateUnchanged
		}
		if !ok || order.ProviderOrderID == "" || (order.State != "submitted" && order.State != "partially_filled") {
			return errors.New("Broker order is not cancelable")
		}
		order.State, order.UpdatedAt = "cancel_requested", now.UTC()
		state.Brokerage.Orders[orderID] = order
		appendBrokerJournal(&state.Brokerage, orderID, order.RequestID, "provider.cancel_requested", order.ApprovalState, order.State, now.UTC())
		result = order
		return nil
	})
	return result, err
}

func (s *Store) CompleteBrokerCancel(account, orderID, providerRequestID string, providerErr error, now time.Time) (BrokerOrderRecord, error) {
	var result BrokerOrderRecord
	err := s.updateBrokerCAS(account, "broker.cancel.complete", orderID, func(state *AccountState) error {
		order, ok := state.Brokerage.Orders[orderID]
		if !ok || order.State != "cancel_requested" {
			return errors.New("Broker cancel request is not active")
		}
		action := "provider.cancel_accepted"
		if providerRequestID == "" {
			providerRequestID = brokerage.ErrorRequestID(providerErr)
		}
		order.ProviderHTTPRequestID = providerRequestID
		if providerErr != nil {
			code := brokerage.ErrorCode(providerErr)
			if code == "ORDER_CANCELLATION_DISABLED" || code == "BROKER_NOT_CONFIGURED" || code == "ACCOUNT_NOT_LINKED" || code == "ORDER_REQUEST_INVALID" {
				order.State, action = "submitted", "provider.cancel_not_attempted"
			} else {
				// A transport or provider failure cannot prove whether cancellation
				// took effect. Reconciliation, not a blind retry, resolves it.
				order.State, action = "submitted_unknown", "provider.cancel_unknown"
			}
		}
		order.UpdatedAt = now.UTC()
		state.Brokerage.Orders[orderID] = order
		if outbox, ok := state.Brokerage.Outbox[orderID]; ok {
			outbox.ProviderHTTPRequestID, outbox.UpdatedAt = providerRequestID, now.UTC()
			state.Brokerage.Outbox[orderID] = outbox
		}
		appendBrokerJournal(&state.Brokerage, orderID, order.RequestID, action, order.ApprovalState, order.State, now.UTC(), BrokerProviderAudit{RawStatus: order.ProviderRawStatus, HTTPRequestID: providerRequestID})
		result = order
		return nil
	})
	return result, err
}

func (s *Store) ApplyBrokerReconciliation(account string, snapshot brokerage.AccountSnapshot, now time.Time) error {
	return s.updateBrokerCAS(account, "broker.reconcile", "", func(state *AccountState) error {
		byClient := map[string]brokerage.Order{}
		for _, order := range snapshot.Orders {
			if order.ClientOrderID != "" {
				if _, duplicate := byClient[order.ClientOrderID]; duplicate {
					return errors.New("Broker reconciliation contains duplicate client order ids")
				}
			}
			byClient[order.ClientOrderID] = order
		}
		for orderID, outbox := range state.Brokerage.Outbox {
			providerOrder, exists := byClient[outbox.ProviderClientOrderID]
			if !exists {
				continue
			}
			order := state.Brokerage.Orders[orderID]
			if !brokerOrderIdentityMatches(order, providerOrder) {
				return errors.New("Broker reconciliation order identity mismatch")
			}
			next := normalizeBrokerOrderState(providerOrder.Status)
			if !brokerOrderTransitionAllowed(order.State, next) {
				return errors.New("Broker reconciliation would regress order state")
			}
			outbox.Status, outbox.ProviderOrderID, outbox.ProviderRawStatus, outbox.ProviderHTTPRequestID, outbox.LastErrorCode, outbox.UpdatedAt = brokerOutboxStatus(next), providerOrder.ID, providerOrder.Status, providerOrder.RequestID, brokerOutboxError(next), now.UTC()
			order.ProviderOrderID, order.ProviderRawStatus, order.ProviderHTTPRequestID, order.State, order.UpdatedAt = providerOrder.ID, providerOrder.Status, providerOrder.RequestID, next, now.UTC()
			state.Brokerage.Outbox[orderID], state.Brokerage.Orders[orderID] = outbox, order
			appendBrokerJournal(&state.Brokerage, orderID, order.RequestID, "provider.reconciled", order.ApprovalState, order.State, now.UTC(), BrokerProviderAudit{RawStatus: providerOrder.Status, HTTPRequestID: providerOrder.RequestID})
		}
		cursorParts := append([]string(nil), snapshot.RequestIDs...)
		sort.Strings(cursorParts)
		digest := sha256.Sum256([]byte(strings.Join(cursorParts, "\n") + "\n" + now.UTC().Format(time.RFC3339Nano)))
		state.Brokerage.ReconcileCheckpoint, state.Brokerage.ReconciledAt = "reconcile_"+hex.EncodeToString(digest[:16]), now.UTC()
		return nil
	})
}

func (s *Store) ApplyBrokerTradeEvents(account string, events []brokerage.TradeEvent, cursor string, now time.Time) error {
	if len(events) == 0 || events[len(events)-1].Cursor != cursor || !brokerageCursor(cursor) {
		return errors.New("Broker trade event batch is invalid")
	}
	return s.updateBrokerCAS(account, "broker.events.apply", cursor, func(state *AccountState) error {
		normalizeBrokerageState(&state.Brokerage)
		mapping := state.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
		if mapping.Status != "active" {
			return errors.New("Broker account is not linked")
		}
		seen := map[string]struct{}{}
		latestEventAt := state.Brokerage.TradeEventAt
		for _, event := range events {
			if event.ProviderAccountID != mapping.BrokerAccountID || !brokerageCursor(event.Cursor) {
				return errors.New("Broker trade event tenant or cursor mismatch")
			}
			if event.Cursor == state.Brokerage.EventCursor {
				return errors.New("Broker trade event cursor was already applied")
			}
			if _, duplicate := seen[event.Cursor]; duplicate {
				return errors.New("Broker trade event cursor is duplicated")
			}
			seen[event.Cursor] = struct{}{}
			// Provider events may share a timestamp across independent orders. The
			// provider cursor is the recovery checkpoint; wall time only rejects a
			// strict backwards movement. Per-order time remains strictly monotonic.
			if event.Timestamp.IsZero() || (!latestEventAt.IsZero() && event.Timestamp.Before(latestEventAt)) {
				return errors.New("Broker trade event batch is stale or unordered")
			}
			if event.Timestamp.After(latestEventAt) {
				latestEventAt = event.Timestamp.UTC()
			}
			order, exists := state.Brokerage.Orders[event.Order.ClientOrderID]
			if !exists || !brokerOrderIdentityMatches(order, event.Order) {
				return errors.New("Broker trade event does not match an owned order")
			}
			if event.Timestamp.IsZero() || (!order.ProviderEventAt.IsZero() && !event.Timestamp.After(order.ProviderEventAt)) {
				return errors.New("Broker trade event cursor is stale")
			}
			next := normalizeBrokerOrderState(event.Order.Status)
			if !brokerOrderTransitionAllowed(order.State, next) {
				return errors.New("Broker trade event would regress order state")
			}
			order.ProviderOrderID, order.ProviderRawStatus, order.State, order.ProviderEventCursor, order.ProviderEventAt, order.UpdatedAt = event.Order.ID, event.Order.Status, next, event.Cursor, event.Timestamp.UTC(), now.UTC()
			state.Brokerage.Orders[event.Order.ClientOrderID] = order
			if outbox, ok := state.Brokerage.Outbox[event.Order.ClientOrderID]; ok {
				outbox.ProviderOrderID, outbox.ProviderRawStatus, outbox.Status, outbox.LastErrorCode, outbox.UpdatedAt = event.Order.ID, event.Order.Status, brokerOutboxStatus(next), brokerOutboxError(next), now.UTC()
				state.Brokerage.Outbox[event.Order.ClientOrderID] = outbox
			}
			appendBrokerJournal(&state.Brokerage, event.Order.ClientOrderID, order.RequestID, "provider.event."+event.Event, order.ApprovalState, order.State, now.UTC(), BrokerProviderAudit{RawStatus: event.Order.Status, EventCursor: event.Cursor})
		}
		state.Brokerage.EventCursor, state.Brokerage.TradeEventAt, state.Brokerage.ReconciledAt = cursor, latestEventAt, now.UTC()
		return nil
	})
}

func brokerOrderIdentityMatches(order BrokerOrderRecord, provider brokerage.Order) bool {
	return provider.ClientOrderID == order.Order.OrderID && provider.AssetID == order.Order.AssetID && provider.Symbol == order.Order.Symbol && provider.Side == order.Order.Side && provider.Qty == order.Order.Qty && provider.Type == order.Order.OrderType && provider.LimitPrice == order.Order.LimitPrice && provider.TimeInForce == order.Order.TimeInForce && provider.ExtendedHours == order.Order.ExtendedHours && (order.ProviderOrderID == "" || provider.ID == order.ProviderOrderID)
}

func brokerOrderTransitionAllowed(current, next string) bool {
	if current == next {
		return true
	}
	allowed := map[string]map[string]bool{
		"submitting":        {"submitted": true, "partially_filled": true, "filled": true, "canceled": true, "provider_rejected": true, "provider_expired": true, "submitted_unknown": true},
		"submitted_unknown": {"submitted": true, "partially_filled": true, "filled": true, "canceled": true, "provider_rejected": true, "provider_expired": true},
		"submitted":         {"partially_filled": true, "filled": true, "cancel_requested": true, "canceled": true, "provider_rejected": true, "provider_expired": true},
		"partially_filled":  {"filled": true, "cancel_requested": true, "canceled": true, "provider_expired": true},
		"cancel_requested":  {"partially_filled": true, "filled": true, "canceled": true, "provider_expired": true},
	}
	return allowed[current][next]
}

func brokerageCursor(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, char := range value {
		if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') && char != '.' && char != '_' && char != ':' && char != '-' {
			return false
		}
	}
	return true
}

func normalizeBrokerOrderState(status string) string {
	switch status {
	case "new", "accepted", "pending_new", "accepted_for_bidding", "stopped", "calculated", "held", "pending_replace", "replaced":
		return "submitted"
	case "partially_filled":
		return "partially_filled"
	case "filled":
		return "filled"
	case "pending_cancel":
		return "cancel_requested"
	case "canceled":
		return "canceled"
	case "expired":
		return "provider_expired"
	case "rejected":
		return "provider_rejected"
	default:
		return "submitted_unknown"
	}
}

func brokerOutboxStatus(orderState string) string {
	if orderState == "provider_rejected" {
		return "provider_rejected"
	}
	return "submitted"
}

func brokerOutboxError(orderState string) string {
	if orderState == "provider_rejected" {
		return "PROVIDER_REJECTED"
	}
	return ""
}

type BrokerDispatcher struct {
	Store   *Store
	Adapter brokerage.BrokerageAdapter
	Now     func() time.Time
}

func (d BrokerDispatcher) Dispatch(ctx context.Context, account, orderID string) (BrokerOrderRecord, error) {
	if d.Store == nil || d.Adapter == nil {
		return BrokerOrderRecord{}, errors.New("Broker dispatcher is incomplete")
	}
	now := time.Now
	if d.Now != nil {
		now = d.Now
	}
	claim, err := d.Store.ClaimBrokerDispatch(account, orderID, now())
	if err != nil {
		return BrokerOrderRecord{}, err
	}
	if claim.BlockedCode != "" {
		return claim.Order, &brokerage.Error{Code: claim.BlockedCode}
	}
	request := brokerage.SubmitOrderRequest{ClientOrderID: claim.Outbox.ProviderClientOrderID, AssetID: claim.Order.Order.AssetID, Symbol: claim.Order.Order.Symbol, Side: claim.Order.Order.Side, Qty: claim.Order.Order.Qty, Type: claim.Order.Order.OrderType, LimitPrice: claim.Order.Order.LimitPrice, TimeInForce: claim.Order.Order.TimeInForce, ExtendedHours: claim.Order.Order.ExtendedHours}
	if err := d.validateDispatchPreflight(ctx, account, claim.Order, now()); err != nil {
		completed, completeErr := d.Store.CompleteBrokerDispatch(account, orderID, nil, &brokerage.Error{Code: "ORDER_PREFLIGHT_FAILED"}, now())
		if completeErr != nil {
			return BrokerOrderRecord{}, completeErr
		}
		return completed, err
	}
	providerOrder, providerErr := d.Adapter.SubmitOrder(ctx, account, d.Store, request)
	completed, completeErr := d.Store.CompleteBrokerDispatch(account, orderID, &providerOrder, providerErr, now())
	if completeErr != nil {
		return BrokerOrderRecord{}, completeErr
	}
	if providerErr != nil {
		return completed, providerErr
	}
	return completed, nil
}

func (d BrokerDispatcher) validateDispatchPreflight(ctx context.Context, account string, order BrokerOrderRecord, now time.Time) error {
	providerAccount, err := d.Adapter.Account(ctx, account, d.Store)
	if err != nil || providerAccount.ID != order.BrokerAccountID || providerAccount.Status != "ACTIVE" || providerAccount.Currency != "USD" || providerAccount.TradingBlocked || providerAccount.AccountBlocked || providerAccount.TradeSuspendedByUser {
		return errors.New("Broker account preflight failed")
	}
	assets, err := d.Adapter.Assets(ctx)
	if err != nil {
		return errors.New("Broker asset preflight failed")
	}
	assetOK := false
	for _, asset := range assets.Assets {
		if asset.ID == order.Order.AssetID && asset.Symbol == order.Order.Symbol && asset.Class == order.Order.AssetClass && asset.Status == "active" && asset.Tradable {
			assetOK = true
		}
	}
	if !assetOK {
		return errors.New("Broker asset is not currently tradable")
	}
	quote, err := d.Adapter.Quote(ctx, order.Order.Symbol)
	quoteAt, quoteTimeErr := time.Parse(time.RFC3339Nano, quote.Timestamp)
	if err != nil || quoteTimeErr != nil || quote.Symbol != order.Order.Symbol || quoteAt.After(now.UTC().Add(5*time.Second)) || now.UTC().Sub(quoteAt) > 2*time.Minute {
		return errors.New("Broker quote preflight is unavailable or stale")
	}
	positions, _, err := d.Adapter.Positions(ctx, account, d.Store)
	if err != nil {
		return errors.New("Broker positions preflight failed")
	}
	if order.Order.Side == "buy" {
		if decimalLess(providerAccount.Cash, order.Order.MaxCost) || decimalLess(providerAccount.BuyingPower, order.Order.MaxCost) {
			return errors.New("Broker settled cash or buying power is below the signed maximum cost")
		}
	} else {
		available := "0"
		for _, position := range positions {
			if position.AssetID == order.Order.AssetID && position.Symbol == order.Order.Symbol {
				available = position.AvailableQty
			}
		}
		if decimalLess(available, order.Order.Qty) {
			return errors.New("Broker available position is below the signed sell quantity")
		}
	}
	return nil
}

func decimalLess(left, right string) bool {
	a, okA := new(big.Rat).SetString(left)
	b, okB := new(big.Rat).SetString(right)
	return !okA || !okB || a.Cmp(b) < 0
}

func (d BrokerDispatcher) Reconcile(ctx context.Context, account string) (brokerage.AccountSnapshot, error) {
	if d.Store == nil || d.Adapter == nil {
		return brokerage.AccountSnapshot{}, errors.New("Broker dispatcher is incomplete")
	}
	snapshot, err := d.Adapter.Reconcile(ctx, account, d.Store)
	if err != nil {
		return brokerage.AccountSnapshot{}, err
	}
	brokerAccount, err := d.Store.ResolveBrokerAccount(ctx, account, FinanceOrderProvider, FinanceOrderTradingEnv)
	if err != nil || snapshot.Provider != FinanceOrderProvider || snapshot.Environment != FinanceOrderTradingEnv || snapshot.Account.ID != brokerAccount {
		return brokerage.AccountSnapshot{}, errors.New("Broker reconciliation snapshot identity mismatch")
	}
	now := time.Now()
	if d.Now != nil {
		now = d.Now()
	}
	if err := d.Store.ApplyBrokerReconciliation(account, snapshot, now); err != nil {
		return brokerage.AccountSnapshot{}, err
	}
	return snapshot, nil
}

func (d BrokerDispatcher) Cancel(ctx context.Context, account, orderID string) (BrokerOrderRecord, error) {
	if d.Store == nil || d.Adapter == nil {
		return BrokerOrderRecord{}, errors.New("Broker dispatcher is incomplete")
	}
	now := time.Now
	if d.Now != nil {
		now = d.Now
	}
	claimed, err := d.Store.RequestBrokerCancel(account, orderID, now())
	if err != nil {
		return BrokerOrderRecord{}, err
	}
	providerRequestID, providerErr := d.Adapter.CancelOrder(ctx, account, d.Store, claimed.ProviderOrderID)
	completed, completeErr := d.Store.CompleteBrokerCancel(account, orderID, providerRequestID, providerErr, now())
	if completeErr != nil {
		return BrokerOrderRecord{}, completeErr
	}
	if providerErr != nil {
		return completed, providerErr
	}
	return completed, nil
}
