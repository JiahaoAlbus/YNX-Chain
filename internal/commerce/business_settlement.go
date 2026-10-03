package commerce

import (
	"context"
	"encoding/json"
	"time"
)

type settlementEffectInput struct {
	Order   Order
	BaseURL string
}

// One signed action admits one observation. A new signed action can GET again
// without resending any payment; the provider's original receipt is retained.
func (s *Server) settlementEffect(target string, body []byte, proof businessActionAuthorization) (businessEffectPlan, error) {
	var empty struct{}
	if err := decodeBusinessBody(body, &empty); err != nil {
		return businessEffectPlan{}, err
	}
	pay := s.cfg.Pay
	if pay.BaseURL == "" || pay.APIKey == "" {
		return businessEffectPlan{}, ErrUnavailable
	}
	pay.Client = guardedEffectHTTPClient(pay.Client, 10*time.Second)
	plan := businessEffectPlan{kind: "pay.settlement", target: target, key: businessNonceDigest(proof.SessionBinding, proof.Nonce), status: 200}
	plan.prepare = func(tx *Store, actor string) (json.RawMessage, error) {
		order, err := tx.Order(actor, "buyer", target)
		if err != nil {
			return nil, err
		}
		if order.InvoiceID == "" {
			return nil, ErrInvalidState
		}
		return encodeEffect(settlementEffectInput{order, pay.BaseURL})
	}
	plan.check = func(tx *Store, actor string, record BusinessEffect) error {
		var saved settlementEffectInput
		if err := decodeEffect(record.Input, &saved); err != nil {
			return err
		}
		current, err := tx.Order(actor, "buyer", target)
		if err != nil {
			return err
		}
		old := saved.Order
		if saved.BaseURL != pay.BaseURL || current.InvoiceID != old.InvoiceID || current.PayIntentID != old.PayIntentID || current.PayMerchant != old.PayMerchant || current.PayPayoutAddress != old.PayPayoutAddress || current.TotalYNXT != old.TotalYNXT || current.Currency != old.Currency || current.Buyer != old.Buyer || current.StoreID != old.StoreID {
			return ErrConflict
		}
		if current.Status != "paid" && (current.Status != "payment_pending" || !current.ReservationExpiresAt.After(tx.now())) {
			return ErrInvalidState
		}
		return nil
	}
	plan.send = func(ctx context.Context, record BusinessEffect) (json.RawMessage, error) {
		var saved settlementEffectInput
		if err := decodeEffect(record.Input, &saved); err != nil {
			return nil, err
		}
		result, err := pay.Settlement(ctx, saved.Order.InvoiceID)
		if err != nil {
			return nil, err
		}
		return encodeEffect(result)
	}
	plan.finish = func(tx *Store, actor string, record BusinessEffect) (any, error) {
		var receipt SettlementEvidence
		if err := decodeEffect(record.Result, &receipt); err != nil {
			return nil, err
		}
		return tx.ConfirmSettlement(target, receipt)
	}
	plan.view = func(tx *Store, actor string, record BusinessEffect) (any, error) {
		return tx.Order(actor, "buyer", target)
	}
	return plan, nil
}
