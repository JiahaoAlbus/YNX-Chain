package commerce

import (
	"context"
	"encoding/json"
	"time"
)

// A bounded observation of the original Pay intent. This DTO deliberately has
// no paid/refunded amount, signing Member, invoice link or private DomainData.
// Only the independent original Core funds proof can change Shop settlement.
type NativeShopIntentObservation struct {
	OrderID           string `json:"orderId"`
	OriginalOperation string `json:"originalOperation"`
	State             string `json:"state"`
	Phase             string `json:"phase"`
	QueryOnly         bool   `json:"queryOnly"`
	FundsVerified     bool   `json:"fundsVerified"`
}

type nativeIntentObservationInput struct {
	Order  Order
	Origin string
}

func originalNativeIntentObservation(order Order, raw json.RawMessage) (NativeShopIntentObservation, error) {
	var view struct {
		IntentID          string `json:"intentId"`
		OriginalOperation string `json:"originalOperation"`
		State             string `json:"state"`
		Phase             string `json:"phase"`
		Merchant          string `json:"merchant"`
		Request           struct {
			ProductID   string `json:"productId"`
			StoreID     string `json:"storeId"`
			SourceOrder string `json:"sourceOrder"`
			Merchant    string `json:"merchant"`
			Recipient   string `json:"recipient"`
		} `json:"request"`
		Terms struct {
			InvoiceID string `json:"invoiceId"`
			Recipient string `json:"recipient"`
		} `json:"terms"`
	}
	if err := json.Unmarshal(raw, &view); err != nil {
		return NativeShopIntentObservation{}, ErrInvalidState
	}
	if view.IntentID != order.PayIntentID || view.OriginalOperation != order.PayIntentID ||
		view.Request.ProductID != "shop.order" || view.Request.StoreID != order.StoreID ||
		view.Request.SourceOrder != order.ID || view.Request.Merchant != order.PayMerchant ||
		view.Merchant != order.PayMerchant || view.Request.Recipient != order.PayPayoutAddress ||
		view.Terms.Recipient != order.PayPayoutAddress || view.Terms.InvoiceID != order.InvoiceID ||
		(view.State != "PREPARED" && view.State != "ISSUED") || !nativeShopPaySegment(view.Phase) || len(view.Phase) > 96 {
		return NativeShopIntentObservation{}, ErrConflict
	}
	return NativeShopIntentObservation{OrderID: order.ID, OriginalOperation: order.PayIntentID,
		State: view.State, Phase: view.Phase, QueryOnly: true, FundsVerified: false}, nil
}

func (s *Server) nativePayIntentObservation(target string, proof businessActionAuthorization) (businessEffectPlan, error) {
	if s.cfg.NativePay == nil || s.cfg.NativePay.client.Transport == nil || s.cfg.NativePay.origin == "" {
		return businessEffectPlan{}, ErrUnavailable
	}
	// Copy the supplied concrete consumer and wrap its exact original transport
	// in the existing durable dispatch/current guard. No default HTTP fallback.
	pay := *s.cfg.NativePay
	pay.client = *guardedEffectHTTPClient(&pay.client, 10*time.Second)
	plan := businessEffectPlan{kind: "pay.native-intent", target: target,
		key: businessNonceDigest(proof.SessionBinding, proof.Nonce), status: 200}
	plan.prepare = func(tx *Store, actor string) (json.RawMessage, error) {
		order, err := tx.Order(actor, "buyer", target)
		if err != nil {
			return nil, err
		}
		if _, err := originalNativeShopPayIntentPath(order.PayIntentID); err != nil {
			return nil, err
		}
		if order.InvoiceID == "" || order.PayMerchant == "" || order.PayPayoutAddress == "" {
			return nil, ErrInvalidState
		}
		return encodeEffect(nativeIntentObservationInput{order, pay.origin})
	}
	plan.check = func(tx *Store, actor string, record BusinessEffect) error {
		var saved nativeIntentObservationInput
		if err := decodeEffect(record.Input, &saved); err != nil {
			return err
		}
		order, err := tx.Order(actor, "buyer", target)
		if err != nil {
			return err
		}
		old := saved.Order
		if saved.Origin != pay.origin || order.ID != old.ID || order.Buyer != old.Buyer ||
			order.StoreID != old.StoreID || order.InvoiceID != old.InvoiceID || order.PayIntentID != old.PayIntentID ||
			order.PayMerchant != old.PayMerchant || order.PayPayoutAddress != old.PayPayoutAddress {
			return ErrConflict
		}
		// Expired/cancelled orders still query their original operation. Current
		// catalog prices, stock and reservation deadlines cannot create a new one.
		return nil
	}
	plan.send = func(ctx context.Context, record BusinessEffect) (json.RawMessage, error) {
		var saved nativeIntentObservationInput
		if err := decodeEffect(record.Input, &saved); err != nil {
			return nil, err
		}
		exchange, err := pay.ReadOriginalInvoiceIntent(ctx, saved.Order.PayIntentID)
		if err != nil {
			return nil, err
		}
		return exchange.Response, nil
	}
	observe := func(tx *Store, actor string, record BusinessEffect) (any, error) {
		order, err := tx.Order(actor, "buyer", target)
		if err != nil {
			return nil, err
		}
		return originalNativeIntentObservation(order, record.Result)
	}
	plan.finish, plan.view = observe, observe
	return plan, nil
}
